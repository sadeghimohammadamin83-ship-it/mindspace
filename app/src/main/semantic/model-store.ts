/**
 * The model files on disk: userData/models/<repo>/<revision>/. Nothing is
 * downloaded unless the user starts setup explicitly. A download fetches
 * ONLY the pinned model files from Hugging Face (no user data is sent),
 * writes each to `<name>.part`, checks its SHA-256 and size, then renames it
 * into place. After one full verification a small marker records each file's
 * size and mtime, so later launches do not re-hash ~120 MB.
 */
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ModelError } from '@shared/retrieval'
import { E5_MODEL, modelDownloadUrl } from './model-manifest'

const MARKER = '.verified.json'

export class ModelStoreError extends Error {
  constructor(readonly code: ModelError, message?: string) {
    super(message ?? code)
    this.name = 'ModelStoreError'
  }
}

type FileSpec = { path: string; size: number; sha256: string }

async function hashFile(path: string): Promise<string> {
  const h = createHash('sha256')
  await pipeline(createReadStream(path), h)
  return h.digest('hex')
}

export function createModelStore(dir: string, files: readonly FileSpec[] = E5_MODEL.files, fetchImpl: typeof fetch = fetch) {
  const totalBytes = files.reduce((n, f) => n + f.size, 0)

  async function quickCheck(): Promise<boolean> {
    try {
      const marker = JSON.parse(await readFile(join(dir, MARKER), 'utf8')) as Record<string, { size: number; mtimeMs: number; sha256: string }>
      for (const f of files) {
        const m = marker[f.path]
        const s = await stat(join(dir, f.path))
        if (!m || m.sha256 !== f.sha256 || s.size !== f.size || m.size !== s.size || m.mtimeMs !== s.mtimeMs) return false
      }
      return true
    } catch {
      return false
    }
  }

  /** Full verification (hash every file). Writes the marker on success. */
  async function verify(): Promise<boolean> {
    const marker: Record<string, { size: number; mtimeMs: number; sha256: string }> = {}
    for (const f of files) {
      const p = join(dir, f.path)
      let s
      try {
        s = await stat(p)
      } catch {
        return false
      }
      if (s.size !== f.size || (await hashFile(p)) !== f.sha256) return false
      marker[f.path] = { size: s.size, mtimeMs: s.mtimeMs, sha256: f.sha256 }
    }
    await writeFile(join(dir, MARKER), JSON.stringify(marker))
    return true
  }

  return {
    dir,
    totalBytes,
    /** Cheap check used at start-up. */
    isInstalled: () => quickCheck(),
    verify,
    /** Downloads every file that is missing or wrong. `onProgress(bytesDone)` is called as data arrives. */
    async download(onProgress: (done: number) => void, signal?: AbortSignal): Promise<void> {
      let done = 0
      for (const f of files) {
        const target = join(dir, f.path)
        try {
          const s = await stat(target)
          if (s.size === f.size && (await hashFile(target)) === f.sha256) {
            done += f.size
            onProgress(done)
            continue
          }
        } catch {
          /* missing: download */
        }
        try {
          await mkdir(dirname(target), { recursive: true })
        } catch {
          throw new ModelStoreError('disk')
        }
        const part = `${target}.part`
        let res: Response
        try {
          res = await fetchImpl(modelDownloadUrl(f.path), { signal, redirect: 'follow' })
        } catch {
          throw new ModelStoreError('offline')
        }
        if (!res.ok || !res.body) throw new ModelStoreError('download_failed', `HTTP ${res.status}`)
        const h = createHash('sha256')
        let bytes = 0
        const base = done
        const counter = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, ctl) {
            bytes += chunk.byteLength
            if (bytes > f.size) {
              ctl.error(new ModelStoreError('checksum_mismatch', 'file larger than expected'))
              return
            }
            h.update(chunk)
            onProgress(base + bytes)
            ctl.enqueue(chunk)
          }
        })
        try {
          await pipeline(Readable.fromWeb(res.body.pipeThrough(counter) as import('node:stream/web').ReadableStream), createWriteStream(part))
        } catch (err) {
          await rm(part, { force: true })
          if (err instanceof ModelStoreError) throw err
          throw new ModelStoreError(signal?.aborted ? 'download_failed' : 'offline')
        }
        if (bytes !== f.size || h.digest('hex') !== f.sha256) {
          await rm(part, { force: true })
          throw new ModelStoreError('checksum_mismatch')
        }
        try {
          await rename(part, target)
        } catch {
          throw new ModelStoreError('disk')
        }
        done += f.size
      }
      if (!(await verify())) throw new ModelStoreError('checksum_mismatch')
    }
  }
}
export type ModelStore = ReturnType<typeof createModelStore>
