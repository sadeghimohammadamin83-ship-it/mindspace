/**
 * Storage for the semantic index (migration 0004). Reads authoritative text
 * from items / documents / document_pages; writes only the derived tables.
 * Each source is replaced in ONE transaction, so readers see either the old
 * complete set of chunks or the new one, never a mix.
 */
import { createHash } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type { DocumentFormat } from '@shared/documents'
import type { ItemKind } from '@shared/domain'

export type SourceType = 'item' | 'document'

/** One unit of source text that chunks point into: a note's text, or one document page. */
export interface SourceUnit {
  /** One-based page for documents, null for notes. */
  page: number | null
  text: string
}

export interface SourceSnapshot {
  key: string
  type: SourceType
  id: string
  title: string
  version: string
  units: SourceUnit[]
  hash: string
}

export interface StoredChunk {
  id: string
  page: number | null
  ordinal: number
  start: number
  end: number
  text: string
  embedding: Float32Array
}

export interface WorkEntry {
  key: string
  type: SourceType
  id: string
  version: string
  /** Why it needs work. */
  reason: 'new' | 'changed' | 'model' | 'retry'
}

export const sourceKey = (type: SourceType, id: string) => `${type}:${id}`
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

/** The exact text chunks of a note point into. Used for indexing AND for verifying a hit at query time. */
export function itemUnitText(i: { title: string; body: string; url: string | null }): string {
  return [i.title.trim(), i.body.trim(), i.url?.trim() ?? ''].filter(Boolean).join('\n\n')
}

export function toBlob(v: Float32Array): Buffer {
  const b = Buffer.alloc(v.length * 4)
  for (let i = 0; i < v.length; i++) b.writeFloatLE(v[i]!, i * 4)
  return b
}

export function fromBlob(b: Buffer): Float32Array {
  const v = new Float32Array(b.length / 4)
  for (let i = 0; i < v.length; i++) v[i] = b.readFloatLE(i * 4)
  return v
}

export function chunkId(key: string, page: number | null, start: number, end: number, text: string, modelId: string): string {
  return `chk-${sha256(`${key}|${page ?? ''}|${start}|${end}|${modelId}|${sha256(text)}`).slice(0, 32)}`
}

export interface ResolvedItem {
  id: string
  kind: ItemKind
  title: string
  body: string
  url: string | null
}
export interface ResolvedDocument {
  id: string
  title: string
  file_name: string
  format: DocumentFormat
  status: string
}

export function createSemanticRepo(db: Database) {
  const q = {
    item: db.prepare<[string], ResolvedItem>('SELECT id, kind, title, body, url FROM items WHERE id = ?'),
    itemVersion: db.prepare<[string], { v: string }>('SELECT updated_at AS v FROM items WHERE id = ?'),
    doc: db.prepare<[string], ResolvedDocument>('SELECT id, title, file_name, format, status FROM documents WHERE id = ?'),
    docVersion: db.prepare<[string], { v: string; status: string }>('SELECT updated_at AS v, status FROM documents WHERE id = ?'),
    pages: db.prepare<[string], { page: number; text: string }>('SELECT page_no AS page, text FROM document_pages WHERE document_id = ? ORDER BY page_no'),
    page: db.prepare<[string, number], { text: string }>('SELECT text FROM document_pages WHERE document_id = ? AND page_no = ?'),
    source: db.prepare<[string], { content_hash: string; model_id: string; status: string; source_version: string }>(
      'SELECT content_hash, model_id, status, source_version FROM semantic_sources WHERE source_key = ?'
    ),
    delSource: db.prepare('DELETE FROM semantic_sources WHERE source_key = ?'),
    delChunks: db.prepare('DELETE FROM semantic_chunks WHERE source_key = ?'),
    upsertSource: db.prepare(
      `INSERT INTO semantic_sources (source_key, source_type, item_id, document_id, source_version, content_hash, model_id, status, chunk_count, last_error, indexed_at)
       VALUES (@key, @type, @item_id, @document_id, @version, @hash, @model, @status, @count, @error, @at)
       ON CONFLICT (source_key) DO UPDATE SET source_version = excluded.source_version, content_hash = excluded.content_hash,
         model_id = excluded.model_id, status = excluded.status, chunk_count = excluded.chunk_count,
         last_error = excluded.last_error, indexed_at = excluded.indexed_at`
    ),
    touch: db.prepare('UPDATE semantic_sources SET source_version = ? WHERE source_key = ?'),
    insChunk: db.prepare(
      `INSERT INTO semantic_chunks (id, source_key, page, ordinal, char_start, char_end, text, model_id, dimensions, embedding, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    chunk: db.prepare<[string], { id: string; source_key: string; page: number | null; char_start: number; char_end: number; text: string }>(
      'SELECT id, source_key, page, char_start, char_end, text FROM semantic_chunks WHERE id = ?'
    )
  }

  const api = {
    /** Every source that should be in the index right now, with what (if anything) is stored for it. */
    work(modelId: string): { todo: WorkEntry[]; upToDate: number; stale: string[]; failed: number; outdated: number } {
      const rows = db
        .prepare(
          `SELECT 'item' AS type, i.id, i.updated_at AS version, s.source_version AS stored_version, s.model_id, s.status
             FROM items i LEFT JOIN semantic_sources s ON s.source_key = 'item:' || i.id
           UNION ALL
           SELECT 'document', d.id, d.updated_at, s.source_version, s.model_id, s.status
             FROM documents d LEFT JOIN semantic_sources s ON s.source_key = 'document:' || d.id
            WHERE d.status IN ('indexed', 'no_text')
              AND EXISTS (SELECT 1 FROM document_pages p WHERE p.document_id = d.id)`
        )
        .all() as { type: SourceType; id: string; version: string; stored_version: string | null; model_id: string | null; status: string | null }[]
      const todo: WorkEntry[] = []
      let upToDate = 0
      let failed = 0
      let outdated = 0
      for (const r of rows) {
        const key = sourceKey(r.type, r.id)
        const base = { key, type: r.type, id: r.id, version: r.version }
        if (r.stored_version === null) todo.push({ ...base, reason: 'new' })
        else if (r.model_id !== modelId) {
          outdated++
          todo.push({ ...base, reason: 'model' })
        } else if (r.stored_version !== r.version) todo.push({ ...base, reason: 'changed' })
        else if (r.status === 'failed') failed++
        else upToDate++
      }
      // Sources whose document is no longer searchable (processing failed, text removed): drop their chunks.
      const stale = (
        db
          .prepare(
            `SELECT s.source_key FROM semantic_sources s LEFT JOIN documents d ON d.id = s.document_id
              WHERE s.source_type = 'document' AND (d.id IS NULL OR d.status NOT IN ('indexed', 'no_text', 'processing')
                 OR NOT EXISTS (SELECT 1 FROM document_pages p WHERE p.document_id = d.id))`
          )
          .all() as { source_key: string }[]
      ).map((r) => r.source_key)
      return { todo, upToDate, stale, failed, outdated }
    },

    /** Reads the authoritative text of a source. Null if it no longer exists or is not indexable. */
    snapshot(type: SourceType, id: string): SourceSnapshot | null {
      if (type === 'item') {
        const i = q.item.get(id)
        const v = q.itemVersion.get(id)
        if (!i || !v) return null
        const text = itemUnitText(i)
        return { key: sourceKey(type, id), type, id, title: i.title, version: v.v, units: [{ page: null, text }], hash: sha256(`item\n${text}`) }
      }
      const d = q.doc.get(id)
      const v = q.docVersion.get(id)
      if (!d || !v || (d.status !== 'indexed' && d.status !== 'no_text')) return null
      const units = q.pages.all(id).map((p) => ({ page: p.page, text: p.text }))
      if (!units.length) return null
      const hash = sha256(`document\n${d.title}\n${units.map((u) => `\f${u.page}\n${u.text}`).join('')}`)
      return { key: sourceKey(type, id), type, id, title: d.title, version: v.v, units, hash }
    },

    /** Version of the source as it is now (to detect edits made while embedding). */
    currentVersion(type: SourceType, id: string): string | null {
      return (type === 'item' ? q.itemVersion.get(id)?.v : q.docVersion.get(id)?.v) ?? null
    },

    stored: (key: string) => q.source.get(key) ?? null,

    /** Content unchanged since it was indexed (e.g. only tags or status moved updated_at): just record the new version. */
    touch: (key: string, version: string) => void q.touch.run(version, key),

    /** Atomically replaces every chunk of one source. */
    replace(s: SourceSnapshot, modelId: string, dimensions: number, chunks: StoredChunk[], at: string): void {
      db.transaction(() => {
        q.delChunks.run(s.key)
        q.upsertSource.run({
          key: s.key,
          type: s.type,
          item_id: s.type === 'item' ? s.id : null,
          document_id: s.type === 'document' ? s.id : null,
          version: s.version,
          hash: s.hash,
          model: modelId,
          status: 'ready',
          count: chunks.length,
          error: null,
          at
        })
        for (const c of chunks) {
          q.insChunk.run(c.id, s.key, c.page, c.ordinal, c.start, c.end, c.text, modelId, dimensions, toBlob(c.embedding), at)
        }
      })()
    },

    /**
     * Records a failure for this content. Previously committed chunks of an
     * older version are dropped too: they no longer match the source text.
     */
    fail(s: Pick<SourceSnapshot, 'key' | 'type' | 'id' | 'version' | 'hash'>, modelId: string, error: string, at: string): void {
      db.transaction(() => {
        q.delChunks.run(s.key)
        q.upsertSource.run({
          key: s.key,
          type: s.type,
          item_id: s.type === 'item' ? s.id : null,
          document_id: s.type === 'document' ? s.id : null,
          version: s.version,
          hash: s.hash,
          model: modelId,
          status: 'failed',
          count: 0,
          error,
          at
        })
      })()
    },

    remove: (key: string) => void q.delSource.run(key),

    /** Drops everything (used by "rebuild"); chunks cascade. */
    clear: () => void db.exec('DELETE FROM semantic_sources'),

    retryFailed: () => void db.exec("DELETE FROM semantic_sources WHERE status = 'failed'"),

    counts(): { sources: number; chunks: number } {
      return db.prepare("SELECT (SELECT COUNT(*) FROM semantic_sources WHERE status = 'ready') AS sources, (SELECT COUNT(*) FROM semantic_chunks) AS chunks").get() as {
        sources: number
        chunks: number
      }
    },

    /** Streams every vector of one model (vector index load). */
    *vectors(modelId: string): Generator<{ id: string; source_key: string; page: number | null; embedding: Buffer }> {
      const stmt = db.prepare<[string], { id: string; source_key: string; page: number | null; embedding: Buffer }>(
        'SELECT id, source_key, page, embedding FROM semantic_chunks WHERE model_id = ? ORDER BY rowid'
      )
      yield* stmt.iterate(modelId)
    },

    chunk: (id: string) => q.chunk.get(id) ?? null,
    item: (id: string) => q.item.get(id) ?? null,
    document: (id: string) => q.doc.get(id) ?? null,
    pageText: (id: string, page: number) => q.page.get(id, page)?.text ?? null
  }
  return api
}
export type SemanticRepo = ReturnType<typeof createSemanticRepo>
