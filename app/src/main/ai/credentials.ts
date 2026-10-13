/**
 * Encrypted API-key storage. Keys are encrypted in the main process with
 * Electron's safeStorage (Windows: DPAPI; macOS: Keychain; Linux: libsecret/
 * kwallet) and written to a file in the per-user data folder. Nothing here is
 * ever sent to the renderer except `{ state, updatedAt }`.
 *
 * Protection boundary: the OS-backed key means the file is unreadable to other
 * OS users, to a copied profile on another machine, and to anything that just
 * reads the file. It does NOT protect against other processes running as the
 * same OS user (they can ask the OS to decrypt as well) or against malware
 * with that user's rights.
 *
 * Failure policy: if encryption is unavailable the key is NOT saved (no
 * plaintext fallback). A corrupt or undecryptable entry is reported as
 * `unreadable` and kept untouched until the user replaces or removes it; start-up
 * never deletes credentials.
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { CloudProviderId, CredentialInfo } from '@shared/ai'
import { CLOUD_PROVIDERS } from '@shared/ai'

export interface SecretCipher {
  available(): Promise<boolean>
  encrypt(plain: string): Promise<Buffer>
  /** `reencrypt` is true when the OS asks for the secret to be re-saved with a newer key. */
  decrypt(data: Buffer): Promise<{ plain: string; reencrypt: boolean }>
}

export class CredentialError extends Error {
  constructor(
    readonly code: 'encryption_unavailable' | 'write_failed',
    message: string
  ) {
    super(message)
    this.name = 'CredentialError'
  }
}

interface FileShape {
  version: 1
  entries: Partial<Record<CloudProviderId, { data: string; updatedAt: string }>>
}

export interface CredentialStore {
  encryptionAvailable(): Promise<boolean>
  info(provider: CloudProviderId): CredentialInfo
  save(provider: CloudProviderId, key: string): Promise<void>
  remove(provider: CloudProviderId): Promise<void>
  /** Main-process only. Returns null when absent or unreadable. */
  get(provider: CloudProviderId): Promise<string | null>
}

export async function createCredentialStore(file: string, cipher: SecretCipher, now: () => Date = () => new Date()): Promise<CredentialStore> {
  let data: FileShape = { version: 1, entries: {} }
  let corrupt = false
  const unreadable = new Set<CloudProviderId>()

  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as FileShape
    if (parsed?.version !== 1 || typeof parsed.entries !== 'object' || parsed.entries === null) throw new Error('shape')
    for (const p of CLOUD_PROVIDERS) {
      const e = parsed.entries[p]
      if (e && typeof e.data === 'string' && typeof e.updatedAt === 'string') data.entries[p] = { data: e.data, updatedAt: e.updatedAt }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      corrupt = true
      for (const p of CLOUD_PROVIDERS) unreadable.add(p)
    }
  }

  async function persist(): Promise<void> {
    try {
      await mkdir(dirname(file), { recursive: true })
      if (corrupt) {
        // Keep the unreadable file for the user instead of overwriting it silently.
        await rename(file, `${file}.corrupt-${now().getTime()}`).catch(() => undefined)
        corrupt = false
      }
      const tmp = `${file}.tmp`
      await writeFile(tmp, JSON.stringify(data), { mode: 0o600 })
      await rename(tmp, file)
    } catch {
      throw new CredentialError('write_failed', 'The key could not be written to disk.')
    }
  }

  const store: CredentialStore = {
    encryptionAvailable: () => cipher.available(),
    info(provider) {
      const e = data.entries[provider]
      if (unreadable.has(provider)) return { state: 'unreadable', updatedAt: e?.updatedAt ?? null }
      return e ? { state: 'configured', updatedAt: e.updatedAt } : { state: 'none', updatedAt: null }
    },
    async save(provider, key) {
      if (!(await cipher.available())) {
        throw new CredentialError('encryption_unavailable', 'This computer cannot protect stored keys, so the key was not saved.')
      }
      const enc = await cipher.encrypt(key)
      data = { ...data, entries: { ...data.entries, [provider]: { data: enc.toString('base64'), updatedAt: now().toISOString() } } }
      await persist()
      unreadable.delete(provider)
    },
    async remove(provider) {
      const { [provider]: _removed, ...rest } = data.entries
      data = { ...data, entries: rest }
      if (corrupt) {
        // A corrupt file holds nothing we can read; removal clears the flag after preserving it.
        await persist()
      } else if (Object.keys(rest).length === 0) {
        await rm(file, { force: true })
      } else await persist()
      unreadable.delete(provider)
    },
    async get(provider) {
      const e = data.entries[provider]
      if (!e || unreadable.has(provider)) return null
      try {
        const { plain, reencrypt } = await cipher.decrypt(Buffer.from(e.data, 'base64'))
        if (reencrypt) await store.save(provider, plain).catch(() => undefined)
        return plain
      } catch {
        unreadable.add(provider)
        return null
      }
    }
  }
  return store
}

/** The production cipher: Electron safeStorage, asynchronous API. */
export async function electronCipher(): Promise<SecretCipher> {
  const { safeStorage } = await import('electron')
  return {
    async available() {
      try {
        if (!safeStorage.isEncryptionAvailable()) return false
        // On Linux the 'basic_text' backend is effectively plaintext; refuse it.
        if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') return false
        return await safeStorage.isAsyncEncryptionAvailable()
      } catch {
        return false
      }
    },
    encrypt: (plain) => safeStorage.encryptStringAsync(plain),
    async decrypt(data) {
      const r = await safeStorage.decryptStringAsync(data)
      return { plain: r.result, reencrypt: r.shouldReEncrypt }
    }
  }
}
