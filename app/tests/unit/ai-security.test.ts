// @vitest-environment node
/** Credential storage, IPC boundary and egress checks for Phase 6. */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { IpcChannel } from '@shared/ipc'
import { createCredentialStore, CredentialError } from '../../src/main/ai/credentials'
import { ProviderError } from '../../src/main/ai/provider'
import { aiHandlers } from '../../src/main/ipc/ai-handlers'
import { toResultAsync } from '../../src/main/ipc/document-handlers'
import { FakeProvider, reply } from './helpers/ai-mocks'
import { aiHarness, fakeCipher, type Harness } from './helpers/ai-setup'
import { tempDir } from './helpers/db'

const KEY = 'sk-ant-api03-TOPSECRETVALUE0123456789abcdef'
const ROOT = resolve(__dirname, '../..')
let h: Harness | null = null
const dirs: { cleanup: () => void }[] = []
afterEach(async () => {
  await h?.close()
  h = null
  dirs.splice(0).forEach((d) => d.cleanup())
})
const tmp = () => {
  const t = tempDir()
  dirs.push(t)
  return t
}

describe('credential store', () => {
  it('stores keys encrypted; the file never contains the key; only metadata is exposed', async () => {
    const t = tmp()
    const file = join(t.dir, 'creds.json')
    const store = await createCredentialStore(file, fakeCipher(), () => new Date('2026-01-02T03:04:05Z'))
    expect(store.info('anthropic')).toEqual({ state: 'none', updatedAt: null })
    await store.save('anthropic', KEY)
    const raw = readFileSync(file, 'utf8')
    expect(raw).not.toContain(KEY)
    expect(raw).not.toContain(KEY.slice(0, 12))
    expect(Buffer.from(JSON.parse(raw).entries.anthropic.data, 'base64').toString('latin1')).not.toContain('TOPSECRET')
    expect(store.info('anthropic')).toEqual({ state: 'configured', updatedAt: '2026-01-02T03:04:05.000Z' })
    expect(JSON.stringify(store.info('anthropic'))).not.toContain(KEY)
    expect(await store.get('anthropic')).toBe(KEY)
    // A new process (new store instance over the same file) reads it back.
    expect(await (await createCredentialStore(file, fakeCipher())).get('anthropic')).toBe(KEY)
    expect(await store.get('openai')).toBeNull()
  })

  it('replaces and removes keys without touching other providers', async () => {
    const t = tmp()
    const store = await createCredentialStore(join(t.dir, 'c.json'), fakeCipher())
    await store.save('anthropic', 'key-one-11111111')
    await store.save('openai', 'key-two-22222222')
    await store.save('anthropic', 'key-three-3333333')
    expect(await store.get('anthropic')).toBe('key-three-3333333')
    await store.remove('anthropic')
    expect(store.info('anthropic').state).toBe('none')
    expect(await store.get('openai')).toBe('key-two-22222222')
    await store.remove('openai')
    expect(existsSync(join(t.dir, 'c.json'))).toBe(false)
  })

  it('refuses to save (no plaintext fallback) when OS encryption is unavailable', async () => {
    const t = tmp()
    const file = join(t.dir, 'c.json')
    const store = await createCredentialStore(file, fakeCipher(false))
    await expect(store.save('openai', KEY)).rejects.toBeInstanceOf(CredentialError)
    expect(existsSync(file)).toBe(false)
    expect(readdirSync(t.dir)).toEqual([])
    expect(await store.encryptionAvailable()).toBe(false)
  })

  it('reports an undecryptable key as unreadable and keeps it until the user replaces it', async () => {
    const t = tmp()
    const file = join(t.dir, 'c.json')
    const cipher = fakeCipher()
    const store = await createCredentialStore(file, cipher)
    await store.save('anthropic', KEY)
    const before = readFileSync(file, 'utf8')
    cipher.failDecrypt = true
    expect(await store.get('anthropic')).toBeNull()
    expect(store.info('anthropic').state).toBe('unreadable')
    expect(readFileSync(file, 'utf8')).toBe(before) // not deleted or rewritten
    cipher.failDecrypt = false
    await store.save('anthropic', 'replacement-key-123')
    expect(store.info('anthropic').state).toBe('configured')
    expect(await store.get('anthropic')).toBe('replacement-key-123')
  })

  it('a corrupt credentials file is preserved, not overwritten at start-up, and flagged', async () => {
    const t = tmp()
    const file = join(t.dir, 'c.json')
    writeFileSync(file, '{ not json')
    const store = await createCredentialStore(file, fakeCipher())
    expect(store.info('anthropic').state).toBe('unreadable')
    expect(readFileSync(file, 'utf8')).toBe('{ not json')
    await store.save('anthropic', 'fresh-key-12345678')
    expect(readdirSync(t.dir).some((f) => f.startsWith('c.json.corrupt-'))).toBe(true)
    expect(await store.get('anthropic')).toBe('fresh-key-12345678')
  })

  it('production wiring uses the asynchronous safeStorage API and refuses the Linux basic_text backend', () => {
    const src = readFileSync(join(ROOT, 'src/main/ai/credentials.ts'), 'utf8')
    expect(src).toMatch(/encryptStringAsync/)
    expect(src).toMatch(/decryptStringAsync/)
    expect(src).toMatch(/isAsyncEncryptionAvailable/)
    expect(src).toMatch(/basic_text/)
  })
})

describe('keys never reach the renderer, the database or the logs', () => {
  it('save returns metadata only; the SQLite file never contains the key', async () => {
    h = await aiHarness({ provider: () => new FakeProvider(reply('x')) })
    const handlers = aiHandlers(async () => h!.services, () => undefined)
    const ev = {} as never
    const saved = await toResultAsync(() => handlers[IpcChannel.aiSaveKey]!(ev, { provider: 'anthropic', key: KEY }))
    expect(saved.ok).toBe(true)
    expect(JSON.stringify(saved)).not.toContain(KEY)
    expect(JSON.stringify(saved)).not.toContain('TOPSECRET')
    if (saved.ok) expect(saved.value).toMatchObject({ credentials: { anthropic: { state: 'configured' }, openai: { state: 'none' } } })
    const settings = await toResultAsync(() => handlers[IpcChannel.aiGetSettings]!(ev))
    expect(JSON.stringify(settings)).not.toContain('TOPSECRET')
    h.db.pragma('wal_checkpoint(TRUNCATE)')
    for (const f of readdirSync(h.tmp.dir)) {
      if (f.endsWith('.tmp') || statSync(join(h.tmp.dir, f)).isDirectory()) continue
      expect(readFileSync(join(h.tmp.dir, f)).toString('latin1'), f).not.toContain('TOPSECRET')
    }
    const row = h.db.prepare("SELECT value FROM ai_settings WHERE key = 'settings'").get() as { value: string } | undefined
    expect(row?.value ?? '').not.toContain('TOPSECRET')
  })

  it('the bridge has no way to read a key, run SQL or name a URL, path or prompt', () => {
    const preload = readFileSync(join(ROOT, 'src/preload/index.ts'), 'utf8')
    const aiBlock = preload.slice(preload.indexOf('const ai: AiBridge'), preload.indexOf('const bridge:'))
    expect(aiBlock).not.toMatch(/getKey|readKey|revealKey|secret|sql|exec/i)
    const contract = readFileSync(join(ROOT, 'src/shared/ai.ts'), 'utf8')
    const bridge = contract.slice(contract.indexOf('export interface AiBridge'))
    expect(bridge).not.toMatch(/getKey|readKey|apiKey\b.*Promise/i)
    // Every method returns DataResult of a metadata type; none returns a string key.
    expect(bridge).toMatch(/saveKey\(input: \{ provider: CloudProviderId; key: string \}\): Promise<DataResult<AiSettingsView>>/)
    const names = Object.keys(aiHandlers(async () => { throw new Error('unused') }, () => undefined))
    expect(names.sort()).toEqual(
      [IpcChannel.aiGetSettings, IpcChannel.aiUpdateSettings, IpcChannel.aiSaveKey, IpcChannel.aiRemoveKey, IpcChannel.aiTest, IpcChannel.aiAsk, IpcChannel.aiCancel, IpcChannel.aiListConversations, IpcChannel.aiGetConversation, IpcChannel.aiDeleteConversation].sort()
    )
  })

  it('IPC payloads are validated', async () => {
    h = await aiHarness({ provider: () => new FakeProvider(reply('x')) })
    const handlers = aiHandlers(async () => h!.services, () => undefined)
    const ev = {} as never
    const call = (channel: string, arg: unknown) => toResultAsync(() => handlers[channel]!(ev, arg))
    const bad = async (channel: string, arg: unknown) => {
      const r = await call(channel, arg)
      expect(r.ok, `${channel} ${JSON.stringify(arg)?.slice(0, 40)}`).toBe(false)
    }
    for (const arg of [{ provider: 'google', key: 'x'.repeat(20) }, { provider: 'openai', key: 'short' }, { provider: 'openai', key: 'has space inside key' }, { provider: 'openai', key: 'k'.repeat(600) }, { provider: 'ollama', key: 'x'.repeat(20) }, { provider: 'openai', key: 'x'.repeat(20), extra: 1 }, null, 'string', 5]) {
      await bad(IpcChannel.aiSaveKey, arg)
    }
    await bad(IpcChannel.aiRemoveKey, 'ollama')
    await bad(IpcChannel.aiRemoveKey, { provider: 'openai' })
    await bad(IpcChannel.aiTest, 'azure')
    await bad(IpcChannel.aiAsk, { conversationId: null, question: '' })
    await bad(IpcChannel.aiAsk, { conversationId: null, question: 'q', model: 'evil' })
    await bad(IpcChannel.aiAsk, 'just a string')
    await bad(IpcChannel.aiCancel, '../../x')
    await bad(IpcChannel.aiGetConversation, "conv-1' OR 1=1 --")
    await bad(IpcChannel.aiDeleteConversation, 42)
    await bad(IpcChannel.aiUpdateSettings, { unknown: true })
    await bad(IpcChannel.aiUpdateSettings, { ollama: { baseUrl: 'http://evil.example:11434' } })
    await bad(IpcChannel.aiUpdateSettings, { ollama: { baseUrl: 'http://192.168.0.9:11434' } })
    await bad(IpcChannel.aiUpdateSettings, { anthropic: { model: 'bad model; rm -rf' } })
    await bad(IpcChannel.aiUpdateSettings, { provider: 'anthropic' }) // no consent
    expect((await call(IpcChannel.aiUpdateSettings, { ollama: { baseUrl: 'http://localhost:11434', model: 'llama3:8b' } })).ok).toBe(true)
  })

  it('reports an unusable cipher without saving, through the same handler', async () => {
    h = await aiHarness({ provider: () => new FakeProvider(reply('x')), cipher: fakeCipher(false) })
    const handlers = aiHandlers(async () => h!.services, () => undefined)
    const r = await toResultAsync(() => handlers[IpcChannel.aiSaveKey]!({} as never, { provider: 'openai', key: KEY }))
    expect(r.ok).toBe(false)
    expect(JSON.stringify(r)).not.toContain(KEY)
    if (!r.ok) expect(r.error.fields).toEqual({ ai: 'encryption_unavailable' })
    const view = await h.services.settings.view()
    expect(view.encryptionAvailable).toBe(false)
    expect(view.credentials.openai.state).toBe('none')
  })

  it('does not log prompts, questions, passages, answers or keys', () => {
    const dir = join(ROOT, 'src/main/ai')
    for (const f of readdirSync(dir)) {
      const src = readFileSync(join(dir, f), 'utf8')
      for (const m of src.matchAll(/console\.(log|info|warn|error|debug)\(([^)]*)\)/g)) {
        // Only fixed strings and error codes may be logged.
        expect(m[2], `${f}: ${m[0]}`).toMatch(/^'[^']*'(, (code|err instanceof Error \? err\.name : 'error'))?$/)
      }
    }
  })
})

describe('egress', () => {
  it('cloud hosts and network calls exist only inside the adapters', () => {
    const files: string[] = []
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name)
        if (e.isDirectory()) walk(p)
        else if (/\.ts$/.test(e.name)) files.push(p)
      }
    }
    walk(join(ROOT, 'src'))
    const rel = (p: string) => p.slice(ROOT.length + 1).replace(/\\/g, '/')
    const hosts = files.filter((f) => /api\.anthropic\.com|api\.openai\.com/.test(readFileSync(f, 'utf8'))).map(rel).sort()
    expect(hosts).toEqual(['src/main/ai/anthropic.ts', 'src/main/ai/openai.ts'])
    const fetchers = files
      .filter((f) => /\bfetch\(|new (Anthropic|OpenAI)\(|XMLHttpRequest|WebSocket\(/.test(readFileSync(f, 'utf8')))
      .map(rel)
      .sort()
    // Renderer code never makes a request; main does so only in the three adapters and the model downloader.
    expect(fetchers.every((f) => f.startsWith('src/main/'))).toBe(true)
    // protocol.ts only serves the bundled renderer files over app://; ollama.ts calls fetch through an injected reference and is loopback-only (tested above).
    expect(fetchers).toEqual(['src/main/ai/anthropic.ts', 'src/main/ai/openai.ts', 'src/main/protocol.ts'])
    expect(files.filter((f) => /doFetch/.test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['src/main/ai/ollama.ts'])
  })

  it('the renderer content-security-policy still forbids all network access', () => {
    const html = readFileSync(join(ROOT, 'src/renderer/index.html'), 'utf8')
    expect(html).toMatch(/connect-src 'none'/)
  })

  it('Ollama failure never reroutes: only the selected provider is constructed', async () => {
    const fake = new FakeProvider(function* () {
      throw new ProviderError('unavailable', 'down')
    })
    h = await aiHarness({ provider: () => fake })
    await h.services.settings.update({ provider: 'ollama', ollama: { model: 'm' } })
    await h.services.credentials.save('anthropic', KEY)
    await h.services.settings.update({ anthropic: { model: 'x' }, cloudAcknowledged: { anthropic: true } }) // cloud fully configured
    await h.note('Atlas budget', 'Atlas budget is 40000 euros.')
    const r = await h.ask('Atlas budget')
    expect(r.message.errorCode).toBe('unavailable')
    expect(h.makeCalls).toEqual(['ollama'])
  })
})
