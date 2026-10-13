/**
 * Phase 4: imported documents and unified full-text search. Types shared by
 * main, preload and renderer. Document contents never leave this machine.
 */
import type { Id, ItemKind } from './domain'
import type { DataResult } from './ipc'

export const DOCUMENT_FORMATS = ['pdf', 'txt', 'md'] as const
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number]

/**
 * imported: copied, not processed yet · processing: extraction running ·
 * indexed: text stored and searchable · no_text: valid file with no
 * extractable text (e.g. scanned PDF; OCR is not supported) · failed: see `error`.
 */
export const DOCUMENT_STATUSES = ['imported', 'processing', 'indexed', 'no_text', 'failed'] as const
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number]

/** Safe, user-facing error codes. Never a raw path or exception text. */
export const DOCUMENT_ERRORS = [
  'encrypted',
  'corrupt',
  'too_large',
  'too_many_pages',
  'invalid_encoding',
  'missing_file',
  'interrupted',
  'timeout',
  'internal'
] as const
export type DocumentError = (typeof DOCUMENT_ERRORS)[number]

export interface DocumentSummary {
  id: Id
  title: string
  fileName: string
  format: DocumentFormat
  sizeBytes: number
  status: DocumentStatus
  /** PDFs only. */
  pageCount: number | null
  charCount: number | null
  error: DocumentError | null
  importedAt: string
  updatedAt: string
}

export interface DocumentPage {
  documentId: Id
  page: number
  text: string
}

export type ImportRejection = 'unsupported_type' | 'not_a_pdf' | 'empty' | 'too_large' | 'invalid_encoding' | 'unreadable' | 'copy_failed'

export type ImportOutcome =
  | { outcome: 'imported'; fileName: string; document: DocumentSummary }
  | { outcome: 'duplicate'; fileName: string; document: DocumentSummary }
  | { outcome: 'rejected'; fileName: string; reason: ImportRejection }

export type ImportResult = { cancelled: true } | { cancelled: false; results: ImportOutcome[] }

export interface RemoveResult {
  removed: boolean
  /** False if the database rows were removed but the managed copy could not be deleted yet (retried at next start). */
  fileDeleted: boolean
}

/** Search result kinds the user can filter by. */
export const SEARCH_SCOPES = ['item', 'document'] as const
export type SearchScope = (typeof SEARCH_SCOPES)[number]

/** Snippet text plus highlighted ranges (character offsets). Rendered as text, never HTML. */
export interface Snippet {
  text: string
  marks: [number, number][]
}

export type SearchResult =
  | { type: 'item'; id: Id; itemKind: ItemKind; title: string; snippet: Snippet }
  | { type: 'document'; id: Id; format: DocumentFormat; title: string; fileName: string; snippet: Snippet }
  | { type: 'page'; id: Id; format: DocumentFormat; title: string; fileName: string; page: number; snippet: Snippet }

export interface SearchResponse {
  results: SearchResult[]
  total: number
}

export const SEARCH_TEXT_MAX = 200
export const SEARCH_PAGE_MAX = 50

export interface SearchQuery {
  text: string
  scopes?: SearchScope[]
  limit?: number
  offset?: number
}

/** Explicit limits (see docs/adr/0004-documents-and-search.md). */
export const DOCUMENT_LIMITS = {
  pdfBytes: 50 * 1024 * 1024,
  textBytes: 5 * 1024 * 1024,
  pdfPages: 2000,
  extractedChars: 20_000_000,
  pdfTimeoutMs: 120_000
} as const

export interface DocumentsBridge {
  /** Opens the native file dialog in main; the renderer never supplies a path. */
  importDocuments(): Promise<DataResult<ImportResult>>
  list(): Promise<DataResult<DocumentSummary[]>>
  get(id: Id): Promise<DataResult<DocumentSummary>>
  getPage(req: { id: Id; page: number }): Promise<DataResult<DocumentPage>>
  reprocess(id: Id): Promise<DataResult<DocumentSummary>>
  remove(id: Id): Promise<DataResult<RemoveResult>>
  rebuildIndex(): Promise<DataResult<{ entries: number }>>
  search(query: SearchQuery): Promise<DataResult<SearchResponse>>
}
