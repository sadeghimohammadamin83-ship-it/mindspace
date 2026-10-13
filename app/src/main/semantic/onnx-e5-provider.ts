/**
 * Local multilingual-e5-small embeddings with ONNX Runtime (CPU) and the
 * Hugging Face tokenizer (pure JS). Mirrors the reference implementation of
 * the model card: "query: " / "passage: " prefixes, mean pooling over the
 * attention mask, L2 normalisation. Runs wherever it is constructed; the app
 * hosts it in a worker thread (embedding-worker.ts), tests run it directly.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { embedNormalize } from './embed-text'
import { EmbeddingError, validateVectors, type EmbedKind, type EmbeddingModelInfo, type EmbeddingProvider } from './provider'
import { E5_MODEL } from './model-manifest'

type Ort = typeof import('onnxruntime-node')
type Session = import('onnxruntime-node').InferenceSession
type TokenizerT = import('@huggingface/tokenizers').Tokenizer

export interface OnnxE5Options {
  /** Folder holding the files listed in E5_MODEL.files. */
  dir: string
  /** CPU threads for one inference call. Small by default so the machine stays responsive. */
  threads?: number
  /**
   * Inputs per inference call. Default 1: the int8 model quantises
   * activations dynamically per call, so padding and neighbours in a batch
   * shift results slightly (measured: up to 0.011 per component). One input
   * per call makes every stored vector independent of what it was batched with.
   */
  batchSize?: number
}

export class OnnxE5Provider implements EmbeddingProvider {
  readonly info: EmbeddingModelInfo = { modelId: E5_MODEL.modelId, dimensions: E5_MODEL.dimensions, maxTokens: E5_MODEL.maxTokens }
  private ort: Ort | null = null
  private session: Session | null = null
  private tokenizer: TokenizerT | null = null
  private padId = 1
  private loading: Promise<void> | null = null
  private closed = false

  constructor(private readonly options: OnnxE5Options) {}

  init(): Promise<void> {
    if (this.closed) return Promise.reject(new EmbeddingError('closed'))
    this.loading ??= this.load().catch((err) => {
      this.loading = null
      throw err
    })
    return this.loading
  }

  private async load(): Promise<void> {
    const file = (name: string) => join(this.options.dir, name)
    let tokenizerJson: unknown
    let tokenizerConfig: Record<string, unknown>
    try {
      tokenizerJson = JSON.parse(await readFile(file(E5_MODEL.tokenizerFile), 'utf8'))
      tokenizerConfig = JSON.parse(await readFile(file(E5_MODEL.tokenizerConfigFile), 'utf8')) as Record<string, unknown>
    } catch (err) {
      throw new EmbeddingError('model_missing', 'tokenizer files are missing or unreadable', { cause: err })
    }
    try {
      const { Tokenizer } = await import('@huggingface/tokenizers')
      this.tokenizer = new Tokenizer(tokenizerJson as object, tokenizerConfig)
      const pad = typeof tokenizerConfig['pad_token'] === 'string' ? tokenizerConfig['pad_token'] : '<pad>'
      const padIds = this.tokenizer.encode(pad, { add_special_tokens: false }).ids
      if (padIds.length === 1) this.padId = padIds[0]!
      this.ort = await import('onnxruntime-node')
      this.session = await this.ort.InferenceSession.create(file(E5_MODEL.onnxFile), {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all',
        intraOpNumThreads: this.options.threads ?? 2,
        interOpNumThreads: 1
      })
    } catch (err) {
      this.session = null
      throw new EmbeddingError('load_failed', 'could not load the embedding model', { cause: err })
    }
    const names = this.session.inputNames
    if (!names.includes('input_ids') || !names.includes('attention_mask')) {
      throw new EmbeddingError('load_failed', `unexpected model inputs: ${names.join(', ')}`)
    }
  }

  /** Token ids with special tokens, truncated to the model limit (keeping the final </s>). */
  private encode(text: string): number[] {
    const ids = this.tokenizer!.encode(text).ids
    const max = this.info.maxTokens
    return ids.length <= max ? ids : [...ids.slice(0, max - 1), ids[ids.length - 1]!]
  }

  async embed(texts: string[], kind: EmbedKind): Promise<Float32Array[]> {
    await this.init()
    if (this.closed || !this.session || !this.ort) throw new EmbeddingError('closed')
    const prefix = kind === 'query' ? 'query: ' : 'passage: '
    const out: Float32Array[] = []
    const batchSize = this.options.batchSize ?? 1
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize).map((t) => this.encode(prefix + embedNormalize(t)))
      out.push(...(await this.run(batch)))
    }
    validateVectors(out, texts.length, this.info.dimensions)
    return out
  }

  private async run(batch: number[][]): Promise<Float32Array[]> {
    const ort = this.ort!
    const session = this.session!
    const n = batch.length
    const len = Math.max(...batch.map((b) => b.length))
    const ids = new BigInt64Array(n * len)
    const mask = new BigInt64Array(n * len)
    batch.forEach((row, r) => {
      for (let c = 0; c < len; c++) {
        const has = c < row.length
        ids[r * len + c] = BigInt(has ? row[c]! : this.padId)
        mask[r * len + c] = has ? 1n : 0n
      }
    })
    const feeds: Record<string, import('onnxruntime-node').Tensor> = {
      input_ids: new ort.Tensor('int64', ids, [n, len]),
      attention_mask: new ort.Tensor('int64', mask, [n, len])
    }
    if (session.inputNames.includes('token_type_ids')) feeds['token_type_ids'] = new ort.Tensor('int64', new BigInt64Array(n * len), [n, len])
    let hidden: import('onnxruntime-node').Tensor
    try {
      const result = await session.run(feeds)
      hidden = result['last_hidden_state'] ?? result[session.outputNames[0]!]!
    } catch (err) {
      throw new EmbeddingError('inference_failed', 'inference failed', { cause: err })
    }
    const dims = this.info.dimensions
    if (hidden.dims.length !== 3 || hidden.dims[2] !== dims) throw new EmbeddingError('invalid_output', `unexpected output shape ${hidden.dims.join('x')}`)
    const data = hidden.data as Float32Array
    const vectors: Float32Array[] = []
    for (let r = 0; r < n; r++) {
      const v = new Float32Array(dims)
      let count = 0
      for (let c = 0; c < len; c++) {
        if (mask[r * len + c] === 0n) continue
        count++
        const base = (r * len + c) * dims
        for (let d = 0; d < dims; d++) v[d]! += data[base + d]!
      }
      let norm = 0
      for (let d = 0; d < dims; d++) {
        v[d] = v[d]! / count
        norm += v[d]! * v[d]!
      }
      norm = Math.sqrt(norm)
      if (!(norm > 0)) throw new EmbeddingError('invalid_output', 'zero vector')
      for (let d = 0; d < dims; d++) v[d] = v[d]! / norm
      vectors.push(v)
    }
    return vectors
  }

  async close(): Promise<void> {
    this.closed = true
    const s = this.session
    this.session = null
    await s?.release().catch(() => undefined)
  }
}
