/**
 * Phase 5: semantic and hybrid retrieval. Types shared by main, preload and
 * renderer. Everything here describes LOCAL data: embeddings are computed on
 * this machine and no note, document, chunk or query ever leaves it.
 */
import type { Id, ItemKind } from './domain'
import type { DocumentFormat, Snippet } from './documents'
import type { DataResult } from './ipc'

/** How results were found. `hybrid` fuses keyword (FTS5) and semantic lists with reciprocal rank fusion. */
export const RETRIEVAL_MODES = ['hybrid', 'keyword', 'semantic'] as const
export type RetrievalMode = (typeof RETRIEVAL_MODES)[number]

export type RetrievalMethod = 'keyword' | 'semantic'

/** Where a result points. `page` is one-based and only set for PDF pages. */
export type RetrievalSource =
  | { type: 'item'; id: Id; itemKind: ItemKind; title: string }
  | { type: 'document'; id: Id; title: string; fileName: string; format: DocumentFormat; page: number | null }

export interface RetrievalResult {
  /** Stable key of the source location: `item:<id>`, `doc:<id>` or `page:<id>:<n>`. */
  key: string
  source: RetrievalSource
  /** The stored chunk that matched semantically, when there is one. */
  chunkId: string | null
  /** Excerpt cut from the ORIGINAL stored text. Rendered as text, never HTML. */
  excerpt: Snippet
  methods: RetrievalMethod[]
  /** 1-based position in this response. */
  rank: number
  /**
   * Raw cosine similarity of the best semantic chunk (model-specific scale,
   * NOT a probability or confidence). Kept for ordering and diagnostics.
   */
  similarity: number | null
}

export type SemanticAvailability =
  /** Semantic results are included. */
  | 'ok'
  /** The model is not installed or failed to load; only keyword results were used. */
  | 'model_unavailable'
  /** Semantic search was not requested. */
  | 'not_requested'

export interface RetrievalResponse {
  mode: RetrievalMode
  results: RetrievalResult[]
  semantic: SemanticAvailability
  /** True while the index is still being built, so some sources may be missing. */
  indexIncomplete: boolean
}

export const RETRIEVAL_SCOPES = ['item', 'document'] as const
export type RetrievalScope = (typeof RETRIEVAL_SCOPES)[number]

export const RETRIEVAL_TEXT_MAX = 500
export const RETRIEVAL_LIMIT_MAX = 30

export interface RetrievalQuery {
  text: string
  mode?: RetrievalMode
  scopes?: RetrievalScope[]
  limit?: number
}

/** Model install state. `missing` until the user runs setup explicitly. */
export type ModelState = 'missing' | 'downloading' | 'verifying' | 'ready' | 'loading' | 'loaded' | 'error'

export type ModelError = 'download_failed' | 'checksum_mismatch' | 'load_failed' | 'disk' | 'offline' | 'internal'

export interface ModelStatus {
  /** e.g. `multilingual-e5-small@<revision>/q8` */
  modelId: string
  displayName: string
  license: string
  dimensions: number
  state: ModelState
  error: ModelError | null
  /** Total download size in bytes and how much is done (only while downloading). */
  bytesTotal: number
  bytesDone: number
  source: string
}

export interface IndexStatus {
  state: 'idle' | 'indexing' | 'paused'
  /** Sources (notes, documents) the current pass still has to embed. */
  pending: number
  done: number
  failed: number
  sources: number
  chunks: number
  /** Sources whose stored vectors belong to another model and will be rebuilt. */
  outdated: number
}

export interface SemanticStatus {
  model: ModelStatus
  index: IndexStatus
}

export interface RetrievalBridge {
  status(): Promise<DataResult<SemanticStatus>>
  /** Explicit user action: download (if needed), verify and load the local model, then index. */
  setupModel(): Promise<DataResult<SemanticStatus>>
  /** Discards stored vectors and re-embeds everything with the current model. */
  rebuildIndex(): Promise<DataResult<SemanticStatus>>
  retrieve(query: RetrievalQuery): Promise<DataResult<RetrievalResponse>>
}
