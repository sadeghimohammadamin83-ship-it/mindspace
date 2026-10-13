/**
 * The embedding-provider seam. The indexer and the retrieval service only
 * talk to this interface, so another local model or runtime can be added
 * without touching chunking, storage or ranking. Providers must run on this
 * machine: no implementation may send text anywhere.
 */

export type EmbedKind = 'query' | 'passage'

export interface EmbeddingModelInfo {
  /** Identifies the exact weights + preprocessing. Stored with every vector; a change forces re-embedding. */
  modelId: string
  dimensions: number
  /** Longest input in model tokens; longer inputs are truncated by the provider. */
  maxTokens: number
}

export type EmbeddingErrorCode = 'model_missing' | 'load_failed' | 'inference_failed' | 'invalid_output' | 'closed'

export class EmbeddingError extends Error {
  constructor(
    readonly code: EmbeddingErrorCode,
    message?: string,
    options?: { cause?: unknown }
  ) {
    super(message ?? code, options)
    this.name = 'EmbeddingError'
  }
}

export interface EmbeddingProvider {
  readonly info: EmbeddingModelInfo
  /** Loads the model once. Safe to call repeatedly; rejects with EmbeddingError. */
  init(): Promise<void>
  /** One L2-normalised vector of `info.dimensions` floats per input, in order. Empty strings are rejected by the caller. */
  embed(texts: string[], kind: EmbedKind): Promise<Float32Array[]>
  close(): Promise<void>
}

/** Rejects vectors a broken model or runtime could produce (wrong size, NaN, zero). */
export function validateVectors(vectors: Float32Array[], expected: number, dimensions: number): void {
  if (vectors.length !== expected) throw new EmbeddingError('invalid_output', `expected ${expected} vectors, got ${vectors.length}`)
  for (const v of vectors) {
    if (!(v instanceof Float32Array) || v.length !== dimensions) throw new EmbeddingError('invalid_output', 'wrong vector dimensions')
    let norm = 0
    for (let i = 0; i < v.length; i++) {
      const x = v[i]!
      if (!Number.isFinite(x)) throw new EmbeddingError('invalid_output', 'non-finite value')
      norm += x * x
    }
    if (Math.abs(Math.sqrt(norm) - 1) > 1e-3) throw new EmbeddingError('invalid_output', 'vector is not normalised')
  }
}
