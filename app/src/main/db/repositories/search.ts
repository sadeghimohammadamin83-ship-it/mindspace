/**
 * The unified full-text index (FTS5 table `search_index`). Every write goes
 * through here so each source has exactly one sync path. Queries are built
 * from normalised letter/digit terms, each quoted, so user input can never
 * inject FTS syntax; all values are bound parameters.
 */
import type { Database } from 'better-sqlite3'
import type { Id, ItemKind } from '@shared/domain'
import type { DocumentFormat, SearchResponse, SearchResult, SearchScope, Snippet } from '@shared/documents'
import { normalizeMapped, queryTerms, searchNormalize } from '@shared/search-text'

interface IndexRow {
  kind: 'item' | 'document' | 'page'
  ref_id: string
  page: number | null
  rank: number
}

const SNIPPET_RADIUS = 70

/** Cuts a window of the ORIGINAL text around the first matching term and marks every term inside it. */
export function makeSnippet(original: string, terms: string[], radius = SNIPPET_RADIUS): Snippet {
  const { text: norm, map } = normalizeMapped(original)
  const flatEnd = (o: number) => o
  let first = -1
  for (const t of terms) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(t)}`, 'u')
    const m = re.exec(norm)
    if (m && (first < 0 || m.index < first)) first = m.index
  }
  const startOrig = first < 0 ? 0 : Math.max(0, map[first]! - radius)
  const endOrig = first < 0 ? Math.min(original.length, radius * 2) : Math.min(original.length, map[first]! + radius * 2)
  const marks: [number, number][] = []
  for (const t of terms) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(t)}`, 'gu')
    for (const m of norm.matchAll(re)) {
      const s = map[m.index]!
      const lastIdx = m.index + m[0].length - 1
      const e = map[lastIdx]! + (original.codePointAt(map[lastIdx]!)! > 0xffff ? 2 : 1)
      if (s >= startOrig && e <= endOrig) marks.push([s, flatEnd(e)])
    }
  }
  // Collapse whitespace in the window while shifting the marks along with it.
  const raw = original.slice(startOrig, endOrig)
  let out = ''
  const shift: number[] = []
  let prevSpace = false
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!
    const sp = /\s/.test(c)
    shift.push(out.length)
    if (sp) {
      if (!prevSpace && out.length > 0) out += ' '
      prevSpace = true
    } else {
      out += c
      prevSpace = false
    }
  }
  shift.push(out.length)
  const prefix = startOrig > 0 ? '…' : ''
  const suffix = endOrig < original.length ? '…' : ''
  const merged = marks
    .map(([s, e]) => [shift[s - startOrig]! + prefix.length, shift[e - startOrig]! + prefix.length] as [number, number])
    .sort((a, b) => a[0] - b[0])
    .filter((m, i, arr) => i === 0 || m[0] >= arr[i - 1]![1])
  return { text: prefix + out.trimEnd() + suffix, marks: merged }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** `"term1" "term2"*`: all terms must match; the last one as a prefix (search-as-you-type). */
export function buildMatch(terms: string[]): string {
  return terms.map((t, i) => `"${t.replace(/"/g, '')}"${i === terms.length - 1 ? '*' : ''}`).join(' ')
}

export function createSearchRepo(db: Database) {
  const q = {
    del: db.prepare('DELETE FROM search_index WHERE kind = ? AND ref_id = ?'),
    delDocPages: db.prepare("DELETE FROM search_index WHERE kind IN ('document', 'page') AND ref_id = ?"),
    ins: db.prepare('INSERT INTO search_index (title, body, kind, ref_id, page) VALUES (?, ?, ?, ?, ?)'),
    item: db.prepare<[string], { title: string; body: string; url: string | null; kind: ItemKind }>(
      'SELECT title, body, url, kind FROM items WHERE id = ?'
    ),
    doc: db.prepare<[string], { title: string; file_name: string; format: DocumentFormat }>(
      'SELECT title, file_name, format FROM documents WHERE id = ?'
    ),
    page: db.prepare<[string, number], { text: string }>('SELECT text FROM document_pages WHERE document_id = ? AND page_no = ?')
  }

  const api = {
    indexItem(i: { id: Id; title: string; body: string; url?: string | null }, opts: { fresh?: boolean } = {}): void {
      // `fresh` is for a rebuild that just emptied the table: the per-row DELETE is a full FTS scan (kind/ref_id are UNINDEXED).
      if (!opts.fresh) q.del.run('item', i.id)
      q.ins.run(searchNormalize(i.title), searchNormalize(`${i.body} ${i.url ?? ''}`), 'item', i.id, null)
    },
    removeItem: (id: Id) => void q.del.run('item', id),
    /** Replaces every entry of one document. Call inside the transaction that writes its pages. */
    indexDocument(d: { id: Id; title: string; fileName: string }, pages: { page: number; text: string }[], opts: { fresh?: boolean } = {}): void {
      if (!opts.fresh) q.delDocPages.run(d.id)
      q.ins.run(searchNormalize(`${d.title} ${d.fileName}`), '', 'document', d.id, null)
      // Page rows carry no title, so a title match yields one document hit, not one per page.
      for (const p of pages) {
        const body = searchNormalize(p.text)
        if (body) q.ins.run('', body, 'page', d.id, p.page)
      }
    },
    removeDocument: (id: Id) => void q.delDocPages.run(id),

    /** Rebuilds the whole index from the authoritative tables, atomically. */
    rebuild(): number {
      return db.transaction(() => {
        db.exec('DELETE FROM search_index')
        const items = db.prepare('SELECT id, title, body, url FROM items').all() as { id: string; title: string; body: string; url: string | null }[]
        for (const i of items) api.indexItem(i, { fresh: true })
        const docs = db.prepare('SELECT id, title, file_name FROM documents').all() as { id: string; title: string; file_name: string }[]
        const pages = db.prepare<[string], { page: number; text: string }>('SELECT page_no AS page, text FROM document_pages WHERE document_id = ? ORDER BY page_no')
        for (const d of docs) api.indexDocument({ id: d.id, title: d.title, fileName: d.file_name }, pages.all(d.id), { fresh: true })
        db.exec("INSERT INTO search_index (search_index) VALUES ('optimize')")
        return (db.prepare('SELECT COUNT(*) AS n FROM search_index').get() as { n: number }).n
      })()
    },

    search(text: string, scopes: readonly SearchScope[], limit: number, offset: number): SearchResponse {
      const terms = queryTerms(text)
      if (!terms.length || !scopes.length) return { results: [], total: 0 }
      const kinds = scopes.flatMap((s) => (s === 'item' ? ['item'] : ['document', 'page']))
      const inKinds = kinds.map(() => '?').join(', ')
      const match = buildMatch(terms)
      // Only fixed fragments are interpolated; match and kinds are bound.
      const where = `search_index MATCH ? AND kind IN (${inKinds})`
      let rows: IndexRow[]
      let total: number
      try {
        rows = db
          .prepare(
            `SELECT kind, ref_id, page, bm25(search_index, 5.0, 1.0) AS rank FROM search_index
             WHERE ${where} ORDER BY rank, ref_id, page LIMIT ? OFFSET ?`
          )
          .all(match, ...kinds, limit, offset) as IndexRow[]
        // A short page that is not past the end already tells the total; only a full page needs the (costly) COUNT.
        total =
          rows.length < limit && (rows.length > 0 || offset === 0)
            ? offset + rows.length
            : (db.prepare(`SELECT COUNT(*) AS n FROM search_index WHERE ${where}`).get(match, ...kinds) as { n: number }).n
      } catch (err) {
        // Terms are quoted, so this should not happen; never surface FTS errors as crashes.
        console.error('[search] query failed', err)
        return { results: [], total: 0 }
      }
      const results: SearchResult[] = []
      for (const r of rows) {
        if (r.kind === 'item') {
          const i = q.item.get(r.ref_id)
          if (!i) continue
          const body = i.body || i.url || ''
          results.push({ type: 'item', id: r.ref_id, itemKind: i.kind, title: i.title, snippet: makeSnippet(body, terms) })
        } else {
          const d = q.doc.get(r.ref_id)
          if (!d) continue
          if (r.kind === 'document') {
            results.push({ type: 'document', id: r.ref_id, format: d.format, title: d.title, fileName: d.file_name, snippet: makeSnippet(d.file_name, terms) })
          } else {
            const p = q.page.get(r.ref_id, r.page!)
            if (!p) continue
            results.push({ type: 'page', id: r.ref_id, format: d.format, title: d.title, fileName: d.file_name, page: r.page!, snippet: makeSnippet(p.text, terms) })
          }
        }
      }
      return { results, total }
    },

    /** True when the index is missing entries for stored items (e.g. right after migration 0003). */
    needsRebuild(): boolean {
      const r = db
        .prepare(
          `SELECT (SELECT COUNT(*) FROM items) AS items,
                  (SELECT COUNT(*) FROM search_index WHERE kind = 'item') AS indexed_items,
                  (SELECT COUNT(*) FROM documents) AS docs,
                  (SELECT COUNT(*) FROM search_index WHERE kind = 'document') AS indexed_docs`
        )
        .get() as { items: number; indexed_items: number; docs: number; indexed_docs: number }
      return r.items !== r.indexed_items || r.docs !== r.indexed_docs
    }
  }
  return api
}
export type SearchRepo = ReturnType<typeof createSearchRepo>
