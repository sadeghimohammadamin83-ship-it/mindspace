/**
 * Worker thread entry: extracts one PDF so the main process event loop (and
 * with it every IPC call from the UI) stays responsive. Reads only the
 * managed copy path main hands it.
 */
import { parentPort, workerData } from 'node:worker_threads'
import { readFile } from 'node:fs/promises'
import { extractPdf, ExtractError } from './extract'

async function run(): Promise<void> {
  const { path } = workerData as { path: string }
  try {
    const bytes = new Uint8Array(await readFile(path))
    const result = await extractPdf(bytes)
    parentPort!.postMessage({ ok: true, result })
  } catch (err) {
    const code = err instanceof ExtractError ? err.code : (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing_file' : 'internal'
    parentPort!.postMessage({ ok: false, code })
  }
}
void run()
