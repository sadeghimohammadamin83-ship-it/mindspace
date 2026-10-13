/// <reference types="electron-vite/node" />
/**
 * EmbeddingProvider that runs the ONNX model in a worker thread. One worker
 * per app run, created on first use; calls are serialised by the worker's
 * message queue. A crashed worker rejects pending calls and is recreated on
 * the next init().
 */
import { Worker } from 'node:worker_threads'
import { E5_MODEL } from './model-manifest'
import { EmbeddingError, validateVectors, type EmbedKind, type EmbeddingErrorCode, type EmbeddingModelInfo, type EmbeddingProvider } from './provider'
import workerPath from './embedding-worker?modulePath'

type Reply = { id: number; ok: true; vectors?: Float32Array[] } | { id: number; ok: false; code: EmbeddingErrorCode }

export class WorkerEmbeddingProvider implements EmbeddingProvider {
  readonly info: EmbeddingModelInfo = { modelId: E5_MODEL.modelId, dimensions: E5_MODEL.dimensions, maxTokens: E5_MODEL.maxTokens }
  private worker: Worker | null = null
  private next = 1
  private pending = new Map<number, { resolve: (r: Reply) => void; reject: (e: Error) => void }>()
  private ready: Promise<void> | null = null

  constructor(private readonly options: { dir: string; threads?: number; workerPath?: string }) {}

  private spawn(): Worker {
    const w = new Worker(this.options.workerPath ?? workerPath, {
      workerData: { dir: this.options.dir, threads: this.options.threads ?? 2 },
      resourceLimits: { maxOldGenerationSizeMb: 1024 }
    })
    w.on('message', (r: Reply) => {
      const p = this.pending.get(r.id)
      if (!p) return
      this.pending.delete(r.id)
      p.resolve(r)
    })
    const fail = (err: Error) => {
      for (const p of this.pending.values()) p.reject(err)
      this.pending.clear()
      this.worker = null
      this.ready = null
    }
    w.on('error', (err) => {
      console.error('[semantic] embedding worker crashed', err)
      fail(new EmbeddingError('inference_failed', 'worker crashed'))
    })
    w.on('exit', () => fail(new EmbeddingError('closed')))
    return w
  }

  private call(msg: Record<string, unknown>): Promise<Reply> {
    this.worker ??= this.spawn()
    const id = this.next++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker!.postMessage({ ...msg, id })
    })
  }

  init(): Promise<void> {
    this.ready ??= this.call({ op: 'init' }).then((r) => {
      if (!r.ok) {
        this.ready = null
        throw new EmbeddingError(r.code)
      }
    })
    return this.ready
  }

  async embed(texts: string[], kind: EmbedKind): Promise<Float32Array[]> {
    await this.init()
    const r = await this.call({ op: 'embed', texts, kind })
    if (!r.ok) throw new EmbeddingError(r.code)
    const vectors = r.vectors ?? []
    validateVectors(vectors, texts.length, this.info.dimensions)
    return vectors
  }

  async close(): Promise<void> {
    const w = this.worker
    if (!w) return
    await Promise.race([this.call({ op: 'close' }).catch(() => undefined), new Promise((r) => setTimeout(r, 2000))])
    await w.terminate()
    this.worker = null
    this.ready = null
  }
}
