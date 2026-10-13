/**
 * Document ingestion and lifecycle. Flow for one import:
 *   validate (type, size, magic bytes / UTF-8) → hash → duplicate check →
 *   copy into userData/documents/<id>.<ext> → insert row (processing) →
 *   extract asynchronously → ONE transaction: replace pages + index + status.
 * A document is only `indexed` after that transaction commits. Original
 * files are read once and never modified, moved or deleted; their path is
 * not stored.
 */
import { createHash, randomUUID } from 'node:crypto'
import { readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { Database } from 'better-sqlite3'
import {
  DOCUMENT_LIMITS,
  SEARCH_SCOPES,
  type DocumentError,
  type DocumentFormat,
  type DocumentPage,
  type DocumentStatus,
  type DocumentSummary,
  type ImportOutcome,
  type ImportResult,
  type RemoveResult,
  type SearchResponse
} from '@shared/documents'
import { documentIdSchema, pageRequestSchema, searchQuerySchema } from '@shared/document-contracts'
import { createSearchRepo } from '../db/repositories/search'
import { decodeUtf8, ExtractError, extractText, type Extracted } from '../documents/extract'
import { DataError } from './workspace-service'


interface DocRow {
  id: string
  title: string
  file_name: string
  format: DocumentFormat
  stored_name: string
  size_bytes: number
  status: DocumentStatus
  page_count: number | null
  char_count: number | null
  last_error: string | null
  imported_at: string
  updated_at: string
}

const COLS = 'id, title, file_name, format, stored_name, size_bytes, status, page_count, char_count, last_error, imported_at, updated_at'
const FORMATS: Record<string, { format: DocumentFormat; mime: string }> = {
  '.pdf': { format: 'pdf', mime: 'application/pdf' },
  '.txt': { format: 'txt', mime: 'text/plain' },
  '.md': { format: 'md', mime: 'text/markdown' },
  '.markdown': { format: 'md', mime: 'text/markdown' }
}
export const SUPPORTED_EXTENSIONS = Object.keys(FORMATS).map((e) => e.slice(1))
const STORED_NAME = /^doc-[a-f0-9-]{36}\.(pdf|txt|md)$/

export interface DocumentServiceDeps {
  db: Database
  /** userData/documents: the managed-copy folder. */
  dir: string
  /** Native file dialog in main. Resolves null when the user cancels. */
  selectFiles: () => Promise<string[] | null>
  /** Extracts a PDF from the managed copy (worker thread in production). */
  extractPdf: (path: string) => Promise<Extracted>
  /** Called after a document's stored text or existence changed (semantic re-indexing). */
  onChange?: () => void
  now?: () => Date
}

export function createDocumentService(deps: DocumentServiceDeps) {
  const { db, dir } = deps
  const now = deps.now ?? (() => new Date())
  const index = createSearchRepo(db)
  const running = new Map<string, Promise<void>>()

  const q = {
    get: db.prepare<[string], DocRow>(`SELECT ${COLS} FROM documents WHERE id = ?`),
    list: db.prepare<[], DocRow>(`SELECT ${COLS} FROM documents ORDER BY imported_at DESC, id`),
    byHash: db.prepare<[string], DocRow>(`SELECT ${COLS} FROM documents WHERE content_hash = ?`),
    insert: db.prepare(
      `INSERT INTO documents (id, title, file_name, format, mime_type, stored_name, content_hash, size_bytes, status, imported_at, updated_at)
       VALUES (@id, @title, @file_name, @format, @mime_type, @stored_name, @content_hash, @size_bytes, 'imported', @at, @at)`
    ),
    setStatus: db.prepare('UPDATE documents SET status = ?, last_error = ?, updated_at = ? WHERE id = ?'),
    finish: db.prepare('UPDATE documents SET status = ?, last_error = NULL, page_count = ?, char_count = ?, updated_at = ? WHERE id = ?'),
    delPages: db.prepare('DELETE FROM document_pages WHERE document_id = ?'),
    insPage: db.prepare('INSERT INTO document_pages (document_id, page_no, text) VALUES (?, ?, ?)'),
    page: db.prepare<[string, number], { text: string }>('SELECT text FROM document_pages WHERE document_id = ? AND page_no = ?'),
    hasPages: db.prepare<[string], { n: number }>('SELECT COUNT(*) AS n FROM document_pages WHERE document_id = ?'),
    remove: db.prepare('DELETE FROM documents WHERE id = ?')
  }

  const toSummary = (r: DocRow): DocumentSummary => ({
    id: r.id,
    title: r.title,
    fileName: r.file_name,
    format: r.format,
    sizeBytes: r.size_bytes,
    status: r.status,
    pageCount: r.page_count,
    charCount: r.char_count,
    error: (r.last_error as DocumentError | null) ?? null,
    importedAt: r.imported_at,
    updatedAt: r.updated_at
  })
  const parseId = (id: unknown) => {
    const r = documentIdSchema.safeParse(id)
    if (!r.success) throw new DataError('validation', 'Invalid input', { id: 'Invalid id' })
    return r.data
  }
  const row = (id: string) => {
    const r = q.get.get(id)
    if (!r) throw new DataError('not_found', 'Document not found')
    return r
  }
  /** The database is not trusted to hold safe names (a restored backup could carry any text): only the managed shape resolves. */
  const managedPath = (r: Pick<DocRow, 'stored_name'>) => {
    if (!STORED_NAME.test(r.stored_name)) throw new DataError('internal', 'The stored document name is not valid.')
    return join(dir, r.stored_name)
  }

  /** Reads and validates one user-chosen file. Only the main-process dialog supplies `path`. */
  async function importOne(path: string): Promise<ImportOutcome> {
    const fileName = basename(path).slice(0, 260)
    const type = FORMATS[extname(path).toLowerCase()]
    if (!type) return { outcome: 'rejected', fileName, reason: 'unsupported_type' }
    let bytes: Buffer
    try {
      const info = await stat(path)
      if (!info.isFile()) return { outcome: 'rejected', fileName, reason: 'unreadable' }
      if (info.size === 0) return { outcome: 'rejected', fileName, reason: 'empty' }
      const max = type.format === 'pdf' ? DOCUMENT_LIMITS.pdfBytes : DOCUMENT_LIMITS.textBytes
      if (info.size > max) return { outcome: 'rejected', fileName, reason: 'too_large' }
      // Read once: the bytes we validate and hash are exactly the bytes we copy.
      bytes = await readFile(path)
      if (bytes.length === 0) return { outcome: 'rejected', fileName, reason: 'empty' }
      if (bytes.length > max) return { outcome: 'rejected', fileName, reason: 'too_large' }
    } catch {
      return { outcome: 'rejected', fileName, reason: 'unreadable' }
    }
    if (type.format === 'pdf') {
      if (!bytes.subarray(0, 1024).toString('latin1').includes('%PDF-')) return { outcome: 'rejected', fileName, reason: 'not_a_pdf' }
    } else {
      try {
        decodeUtf8(bytes)
      } catch {
        return { outcome: 'rejected', fileName, reason: 'invalid_encoding' }
      }
    }
    const hash = createHash('sha256').update(bytes).digest('hex')
    const existing = q.byHash.get(hash)
    if (existing) return { outcome: 'duplicate', fileName, document: toSummary(existing) }

    const id = `doc-${randomUUID()}`
    const storedName = `${id}.${type.format}`
    const target = join(dir, storedName)
    try {
      await writeFile(target, bytes, { flag: 'wx' })
    } catch {
      return { outcome: 'rejected', fileName, reason: 'copy_failed' }
    }
    const title = fileName.replace(/\.[^.]+$/, '').trim().slice(0, 200) || fileName
    try {
      q.insert.run({
        id,
        title,
        file_name: fileName,
        format: type.format,
        mime_type: type.mime,
        stored_name: storedName,
        content_hash: hash,
        size_bytes: bytes.length,
        at: now().toISOString()
      })
    } catch (err) {
      await unlink(target).catch(() => undefined)
      // A concurrent import of the same bytes won the UNIQUE(content_hash) race.
      const dup = q.byHash.get(hash)
      if (dup) return { outcome: 'duplicate', fileName, document: toSummary(dup) }
      console.error('[documents] insert failed', err)
      return { outcome: 'rejected', fileName, reason: 'copy_failed' }
    }
    return { outcome: 'imported', fileName, document: toSummary(row(id)) }
  }

  /** Extracts and commits. Never throws; failures end in status `failed` (or keep the previous text on reprocess). */
  async function processDoc(id: string): Promise<void> {
    const r = q.get.get(id)
    if (!r) return
    const previous = r.status
    q.setStatus.run('processing', null, now().toISOString(), id)
    let extracted: Extracted
    try {
      const path = managedPath(r)
      if (r.format === 'pdf') {
        extracted = await deps.extractPdf(path)
      } else {
        let bytes: Buffer
        try {
          bytes = await readFile(path)
        } catch {
          throw new ExtractError('missing_file')
        }
        extracted = extractText(bytes)
      }
    } catch (err) {
      const code: DocumentError = err instanceof ExtractError ? err.code : 'internal'
      if (!(err instanceof ExtractError)) console.error('[documents] extraction failed', err)
      if (!q.get.get(id)) return // removed meanwhile
      // Reprocess failure keeps the earlier usable text searchable; the error is still shown.
      const keep = (previous === 'indexed' || previous === 'no_text') && q.hasPages.get(id)!.n > 0
      q.setStatus.run(keep ? previous : 'failed', code, now().toISOString(), id)
      return
    }
    try {
      db.transaction(() => {
        const cur = q.get.get(id)
        if (!cur) return // removed while extracting
        q.delPages.run(id)
        extracted.pages.forEach((text, i) => q.insPage.run(id, i + 1, text))
        index.indexDocument({ id, title: cur.title, fileName: cur.file_name }, extracted.pages.map((text, i) => ({ page: i + 1, text })))
        const chars = extracted.pages.reduce((n, p) => n + p.length, 0)
        const hasText = extracted.pages.some((p) => p.trim().length > 0)
        q.finish.run(hasText ? 'indexed' : 'no_text', extracted.pageCount, chars, now().toISOString(), id)
      })()
      deps.onChange?.()
    } catch (err) {
      console.error('[documents] commit failed', err)
      if (q.get.get(id)) q.setStatus.run('failed', 'internal', now().toISOString(), id)
    }
  }

  function schedule(id: string): Promise<void> {
    const prev = running.get(id)
    if (prev) return prev
    const p = processDoc(id).finally(() => running.delete(id))
    running.set(id, p)
    return p
  }

  return {
    /** Shows the native dialog and imports the chosen files. Takes no arguments by design. */
    async importDocuments(): Promise<ImportResult> {
      const paths = await deps.selectFiles()
      if (!paths || paths.length === 0) return { cancelled: true }
      const results: ImportOutcome[] = []
      for (const p of paths.slice(0, 50)) {
        const r = await importOne(p)
        results.push(r)
        if (r.outcome === 'imported') void schedule(r.document.id)
      }
      return { cancelled: false, results }
    },
    list: (): DocumentSummary[] => q.list.all().map(toSummary),
    get: (id: unknown): DocumentSummary => toSummary(row(parseId(id))),
    getPage(req: unknown): DocumentPage {
      const r = pageRequestSchema.safeParse(req)
      if (!r.success) throw new DataError('validation', 'Invalid input')
      row(r.data.id)
      const p = q.page.get(r.data.id, r.data.page)
      if (!p) throw new DataError('not_found', 'Page not found')
      return { documentId: r.data.id, page: r.data.page, text: p.text }
    },
    async reprocess(id: unknown): Promise<DocumentSummary> {
      const r = row(parseId(id))
      if (r.status === 'processing' && running.has(r.id)) throw new DataError('conflict', 'Already processing')
      await schedule(r.id)
      return toSummary(row(r.id))
    },
    /** Deletes rows + index in one transaction, then the managed copy. Never touches the original file. */
    async remove(id: unknown): Promise<RemoveResult> {
      const r = row(parseId(id))
      db.transaction(() => {
        index.removeDocument(r.id)
        q.remove.run(r.id) // pages and semantic chunks cascade
      })()
      deps.onChange?.()
      let fileDeleted = true
      try {
        await unlink(managedPath(r))
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          fileDeleted = false
          console.error('[documents] could not delete managed copy; will retry at next start')
        }
      }
      return { removed: true, fileDeleted }
    },
    rebuildIndex: (): { entries: number } => ({ entries: index.rebuild() }),
    search(query: unknown): SearchResponse {
      const r = searchQuerySchema.safeParse(query)
      if (!r.success) throw new DataError('validation', 'Invalid input')
      return index.search(r.data.text, r.data.scopes ?? SEARCH_SCOPES, r.data.limit ?? 20, r.data.offset ?? 0)
    },

    /**
     * Start-up recovery: anything left `processing`/`imported` by a crash is
     * marked failed ('interrupted', retryable), managed copies with no row are
     * deleted, rows whose copy vanished are marked 'missing_file', and the
     * index is rebuilt if it is out of step with the tables.
     */
    async recover(): Promise<{ interrupted: number; orphansRemoved: number; missing: number; rebuilt: boolean }> {
      const at = now().toISOString()
      const interrupted = db
        .prepare("UPDATE documents SET status = 'failed', last_error = 'interrupted', updated_at = ? WHERE status IN ('processing', 'imported')")
        .run(at).changes
      const rows = q.list.all()
      const known = new Set(rows.map((r) => r.stored_name))
      let orphansRemoved = 0
      let names: string[] = []
      try {
        names = await readdir(dir)
      } catch {
        /* folder not created yet */
      }
      for (const n of names) {
        if (STORED_NAME.test(n) && !known.has(n)) {
          await unlink(join(dir, n)).then(() => orphansRemoved++).catch(() => undefined)
        }
      }
      const present = new Set(names)
      let missing = 0
      for (const r of rows) {
        if (!present.has(r.stored_name) && r.last_error !== 'missing_file') {
          q.setStatus.run(r.status === 'indexed' || r.status === 'no_text' ? r.status : 'failed', 'missing_file', at, r.id)
          missing++
        }
      }
      const rebuilt = index.needsRebuild()
      if (rebuilt) index.rebuild()
      return { interrupted, orphansRemoved, missing, rebuilt }
    },
    /** Test hook: resolves when all background processing has settled. */
    idle: () => Promise.all([...running.values()]).then(() => undefined)
  }
}
export type DocumentService = ReturnType<typeof createDocumentService>
