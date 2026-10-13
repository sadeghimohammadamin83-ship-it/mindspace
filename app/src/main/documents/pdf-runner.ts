/// <reference types="electron-vite/node" />
/** Runs one PDF extraction in a worker thread with a hard timeout. */
import { Worker } from 'node:worker_threads'
import { DOCUMENT_LIMITS } from '@shared/documents'
import { ExtractError, type Extracted } from './extract'
import workerPath from './pdf-worker?modulePath'

export function extractPdfInWorker(path: string): Promise<Extracted> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, { workerData: { path }, resourceLimits: { maxOldGenerationSizeMb: 1024 } })
    const timer = setTimeout(() => {
      void worker.terminate()
      reject(new ExtractError('timeout'))
    }, DOCUMENT_LIMITS.pdfTimeoutMs)
    worker.once('message', (msg: { ok: true; result: Extracted } | { ok: false; code: ExtractError['code'] }) => {
      clearTimeout(timer)
      void worker.terminate()
      if (msg.ok) resolve(msg.result)
      else reject(new ExtractError(msg.code))
    })
    worker.once('error', (err) => {
      clearTimeout(timer)
      console.error('[documents] pdf worker crashed', err)
      reject(new ExtractError('internal'))
    })
    worker.once('exit', (code) => {
      clearTimeout(timer)
      if (code !== 0) reject(new ExtractError('internal'))
    })
  })
}
