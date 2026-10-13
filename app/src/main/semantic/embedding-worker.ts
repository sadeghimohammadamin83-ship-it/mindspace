/**
 * Worker-thread host for the ONNX embedding model, so tokenisation, tensor
 * work and pooling never run on the main process event loop. Receives only
 * texts to embed; has no database or network access.
 */
import { parentPort, workerData } from 'node:worker_threads'
import { OnnxE5Provider } from './onnx-e5-provider'
import { EmbeddingError, type EmbedKind } from './provider'

type Request = { id: number; op: 'init' } | { id: number; op: 'embed'; texts: string[]; kind: EmbedKind } | { id: number; op: 'close' }

const provider = new OnnxE5Provider(workerData as { dir: string; threads?: number })

parentPort!.on('message', async (req: Request) => {
  try {
    if (req.op === 'init') {
      await provider.init()
      parentPort!.postMessage({ id: req.id, ok: true })
    } else if (req.op === 'embed') {
      const vectors = await provider.embed(req.texts, req.kind)
      parentPort!.postMessage({ id: req.id, ok: true, vectors }, vectors.map((v) => v.buffer as ArrayBuffer))
    } else {
      await provider.close()
      parentPort!.postMessage({ id: req.id, ok: true })
    }
  } catch (err) {
    const code = err instanceof EmbeddingError ? err.code : 'inference_failed'
    if (!(err instanceof EmbeddingError)) console.error('[semantic] worker error', err)
    else if (err.cause) console.error('[semantic] worker error', err.message, err.cause)
    parentPort!.postMessage({ id: req.id, ok: false, code })
  }
})
