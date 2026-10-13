// @vitest-environment node
/**
 * Phase 4: ingestion, extraction, persistence, FTS5 search and index
 * integrity, against the SYNTHETIC fixtures in tests/fixtures/documents and
 * throwaway databases/folders only.
 */
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, openDatabase } from '../../src/main/db/connection'
import { currentSchemaVersion, MIGRATIONS } from '../../src/main/db/migrations'
import { buildMatch, makeSnippet } from '../../src/main/db/repositories/search'
import { extractPdf, extractText, ExtractError } from '../../src/main/documents/extract'
import { documentHandlers, toResultAsync } from '../../src/main/ipc/document-handlers'
import { createDocumentService } from '../../src/main/services/document-service'
import { createWorkspaceService } from '../../src/main/services/workspace-service'
import { DOCUMENT_LIMITS, type ImportOutcome, type SearchResult } from '@shared/documents'
import { IpcChannel } from '@shared/ipc'
import { tempDir } from './helpers/db'

const FIX = resolve(__dirname, '../fixtures/documents')
const fixture = (n: string) => join(FIX, n)
const pdfFromFile = async (p: string) => extractPdf(new Uint8Array(readFileSync(p)))
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex')

let tmp: ReturnType<typeof tempDir>
let docsDir: string
let picks: string[] | null
beforeEach(() => {
  tmp = tempDir()
  docsDir = join(tmp.dir, 'documents')
  mkdirSync(docsDir)
  picks = null
})
afterEach(() => tmp.cleanup())

function setup(file = tmp.file) {
  const db = openDatabase(file)
  const extract = vi.fn(pdfFromFile)
  const docs = createDocumentService({ db, dir: docsDir, selectFiles: async () => picks, extractPdf: extract })
  const ws = createWorkspaceService(db)
  return { db, docs, ws, extract }
}

async function importFiles(docs: ReturnType<typeof setup>['docs'], ...files: string[]): Promise<ImportOutcome[]> {
  picks = files
  const r = await docs.importDocuments()
  await docs.idle()
  if (r.cancelled) throw new Error('cancelled')
  return r.results
}
const idOf = (r: ImportOutcome) => {
  if (r.outcome === 'rejected') throw new Error(`rejected: ${r.reason}`)
  return r.document.id
}
const pages = (rs: SearchResult[]) => rs.filter((r) => r.type === 'page') as Extract<SearchResult, { type: 'page' }>[]
const marked = (r: SearchResult) => r.snippet.marks.map(([s, e]) => r.snippet.text.slice(s, e))

describe('FTS5 in the real driver', () => {
  it('is compiled into better-sqlite3 and migration 0003 creates the index', () => {
    const { db } = setup()
    expect(currentSchemaVersion(db)).toBe(MIGRATIONS.length)
    expect(MIGRATIONS.some((m) => m.version === 3)).toBe(true)
    expect(db.prepare("SELECT sqlite_compileoption_used('ENABLE_FTS5') AS v").get()).toEqual({ v: 1 })
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'search_index'").get()).toBeTruthy()
    closeDatabase(db)
  })
})

describe('extraction', () => {
  it('extracts a text PDF', async () => {
    const r = await pdfFromFile(fixture('sample-text-pdf.pdf'))
    expect(r.pageCount).toBe(1)
    expect(r.pages[0]).toContain('The amber lantern protocol describes')
  })
  it('keeps page boundaries and blank pages of a multi-page PDF', async () => {
    const r = await pdfFromFile(fixture('sample-multipage.pdf'))
    expect(r.pageCount).toBe(5)
    expect(r.pages[2]).toContain('zephyr quartz ledger')
    expect(r.pages[3]).toBe('')
    expect(r.pages.filter((p) => p.includes('orchid meridian')).length).toBe(2)
  })
  it('extracts Persian and mixed text without changing the stored characters', async () => {
    const r = await pdfFromFile(fixture('sample-persian-pdf.pdf'))
    expect(r.pages[0]).toContain('گزارش آزمایشی فارسی')
    expect(r.pages[1]).toContain('كتاب') // Arabic kaf kept as-is in storage
    expect(r.pages[1]).toContain('پروژه alpha-seven')
  })
  it('returns empty text for an image-only PDF (no OCR, nothing invented)', async () => {
    const r = await pdfFromFile(fixture('sample-scanned.pdf'))
    expect(r.pageCount).toBe(2)
    expect(r.pages.every((p) => p === '')).toBe(true)
  })
  it('reports encrypted and corrupt PDFs with safe codes', async () => {
    await expect(pdfFromFile(fixture('sample-encrypted.pdf'))).rejects.toMatchObject({ code: 'encrypted' })
    await expect(extractPdf(new TextEncoder().encode('%PDF-1.4\n garbage garbage'))).rejects.toBeInstanceOf(ExtractError)
  })
  it('decodes UTF-8 text and rejects malformed bytes instead of guessing', () => {
    const r = extractText(readFileSync(fixture('sample-document.txt')))
    expect(r.pages[0]).toContain('متن آزمایشی فارسی')
    expect(extractText(new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x0d, 0x0a, 0x62])).pages[0]).toBe('a\nb')
    expect(() => extractText(new Uint8Array([0x61, 0xff, 0xfe]))).toThrow(ExtractError)
    expect(() => extractText(new Uint8Array([0x61, 0x00, 0x62]))).toThrow(ExtractError)
  })
})

describe('import', () => {
  it('imports PDF, TXT and Markdown, copies into the managed folder, and leaves the originals untouched', async () => {
    const { docs, db } = setup()
    const names = ['sample-text-pdf.pdf', 'sample-document.txt', 'sample-document.md']
    const before = names.map((n) => sha(fixture(n)))
    const results = await importFiles(docs, ...names.map(fixture))
    expect(results.map((r) => r.outcome)).toEqual(['imported', 'imported', 'imported'])
    const list = docs.list()
    expect(list.map((d) => d.status)).toEqual(['indexed', 'indexed', 'indexed'])
    const pdf = list.find((d) => d.format === 'pdf')!
    expect(pdf).toMatchObject({ title: 'sample-text-pdf', fileName: 'sample-text-pdf.pdf', pageCount: 1, error: null })
    expect(readdirSync(docsDir).sort()).toEqual(list.map((d) => `${d.id}.${d.format}`).sort())
    expect(names.map((n) => sha(fixture(n)))).toEqual(before)
    // No absolute path is stored anywhere.
    const stored = JSON.stringify(db.prepare('SELECT * FROM documents').all())
    expect(stored).not.toContain(FIX)
    closeDatabase(db)
  })

  it('treats a cancelled dialog as cancelled', async () => {
    const { docs, db } = setup()
    picks = null
    expect(await docs.importDocuments()).toEqual({ cancelled: true })
    picks = []
    expect(await docs.importDocuments()).toEqual({ cancelled: true })
    closeDatabase(db)
  })

  it('rejects unsupported types, fake PDFs, empty, oversized and non-UTF-8 files', async () => {
    const { docs, db } = setup()
    const w = (n: string, data: string | Buffer) => {
      const p = join(tmp.dir, n)
      writeFileSync(p, data)
      return p
    }
    const big = join(tmp.dir, 'big.txt')
    writeFileSync(big, Buffer.alloc(DOCUMENT_LIMITS.textBytes + 1, 0x61))
    const results = await importFiles(
      docs,
      w('a.exe', 'MZ'),
      w('fake.pdf', 'hello, not a pdf'),
      w('empty.md', ''),
      big,
      w('latin1.txt', Buffer.from([0x63, 0x61, 0x66, 0xe9])),
      join(tmp.dir, 'missing.pdf')
    )
    expect(results.map((r) => (r.outcome === 'rejected' ? r.reason : r.outcome))).toEqual([
      'unsupported_type',
      'not_a_pdf',
      'empty',
      'too_large',
      'invalid_encoding',
      'unreadable'
    ])
    expect(docs.list()).toEqual([])
    expect(readdirSync(docsDir)).toEqual([])
    closeDatabase(db)
  })

  it('detects duplicates by content hash and never overwrites the existing record', async () => {
    const { docs, db } = setup()
    const [first] = await importFiles(docs, fixture('sample-document.md'))
    const renamed = join(tmp.dir, 'renamed copy.md')
    copyFileSync(fixture('sample-document.md'), renamed)
    const [second] = await importFiles(docs, renamed)
    expect(second).toMatchObject({ outcome: 'duplicate', document: { id: idOf(first!), fileName: 'sample-document.md' } })
    expect(docs.list()).toHaveLength(1)
    expect(readdirSync(docsDir)).toHaveLength(1)
    closeDatabase(db)
  })

  it('reports a copy failure and leaves no record', async () => {
    const { docs, db } = setup()
    chmodSync(docsDir, 0o500)
    try {
      const [r] = await importFiles(docs, fixture('sample-document.txt'))
      // root ignores directory permissions; only assert when the OS enforced them
      if (process.getuid?.() !== 0) {
        expect(r).toMatchObject({ outcome: 'rejected', reason: 'copy_failed' })
        expect(docs.list()).toEqual([])
      }
    } finally {
      chmodSync(docsDir, 0o700)
    }
    closeDatabase(db)
  })

  it('marks image-only PDFs as no_text and encrypted PDFs as failed, never as indexed', async () => {
    const { docs, db } = setup()
    const [scan, enc] = await importFiles(docs, fixture('sample-scanned.pdf'), fixture('sample-encrypted.pdf'))
    expect(docs.get(idOf(scan!))).toMatchObject({ status: 'no_text', pageCount: 2, error: null })
    expect(docs.get(idOf(enc!))).toMatchObject({ status: 'failed', error: 'encrypted' })
    expect(docs.search({ text: 'scanned' }).results.filter((r) => r.type === 'page')).toEqual([])
    closeDatabase(db)
  })
})

describe('search', () => {
  async function seeded() {
    const s = setup()
    const rs = await importFiles(
      s.docs,
      fixture('sample-text-pdf.pdf'),
      fixture('sample-persian-pdf.pdf'),
      fixture('sample-multipage.pdf'),
      fixture('sample-document.txt'),
      fixture('sample-document.md')
    )
    return { ...s, ids: rs.map(idOf) }
  }

  it('finds PDF page text with the correct page number and an accurate snippet', async () => {
    const { docs, db, ids } = await seeded()
    const hits = pages(docs.search({ text: 'zephyr quartz' }).results)
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ id: ids[2], page: 3, format: 'pdf', title: 'sample-multipage' })
    expect(hits[0]!.snippet.text).toContain('The zephyr quartz ledger appears only on this page.')
    expect(marked(hits[0]!)).toEqual(['zephyr', 'quartz'])
    closeDatabase(db)
  })

  it('returns every page that matches a phrase on several pages', async () => {
    const { docs, db } = await seeded()
    expect(pages(docs.search({ text: 'orchid meridian' }).results).map((h) => h.page).sort()).toEqual([2, 3])
    closeDatabase(db)
  })

  it('matches document titles and file names', async () => {
    const { docs, db, ids } = await seeded()
    const r = docs.search({ text: 'multipage' }).results
    expect(r[0]).toMatchObject({ type: 'document', id: ids[2] })
    closeDatabase(db)
  })

  it('searches TXT and Markdown contents; Markdown is plain text, not HTML', async () => {
    const { docs, db, ids } = await seeded()
    expect(pages(docs.search({ text: 'cobalt harbor' }).results)[0]).toMatchObject({ id: ids[3], format: 'txt', page: 1 })
    const md = pages(docs.search({ text: 'saffron' }).results)
    expect(md[0]).toMatchObject({ id: ids[4], format: 'md' })
    const script = pages(docs.search({ text: 'alert' }).results)[0]!
    expect(script.snippet.text).toContain('<script>') // returned as text; the UI renders it as text
    closeDatabase(db)
  })

  it('handles Persian, Arabic-letter variants and mixed queries', async () => {
    const { docs, db, ids } = await seeded()
    expect(pages(docs.search({ text: 'گزارش آزمایشی' }).results)[0]).toMatchObject({ id: ids[1], page: 1 })
    // Stored as Arabic kaf (ك); a query with Persian kaf (ک) still matches page 2.
    const kaf = pages(docs.search({ text: 'کتاب' }).results)[0]!
    expect(kaf).toMatchObject({ id: ids[1], page: 2 })
    expect(marked(kaf)).toEqual(['كتاب'])
    expect(pages(docs.search({ text: 'پروژه alpha' }).results)[0]).toMatchObject({ id: ids[1], page: 2 })
    expect(pages(docs.search({ text: 'برنامه بندر' }).results)[0]).toMatchObject({ id: ids[3] })
    closeDatabase(db)
  })

  it('is case-insensitive, prefix-matches the last term, and handles empty, no-result and hostile queries', async () => {
    const { docs, db } = await seeded()
    expect(pages(docs.search({ text: 'AMBER LANT' }).results)).toHaveLength(1)
    expect(docs.search({ text: '' })).toEqual({ results: [], total: 0 })
    expect(docs.search({ text: '   ' })).toEqual({ results: [], total: 0 })
    expect(docs.search({ text: 'nonexistentword' })).toEqual({ results: [], total: 0 })
    for (const q of ['"', 'NEAR(', 'a OR', '*', 'title:x', "'; DROP TABLE documents; --", '(((', 'AND NOT', '^x']) {
      expect(() => docs.search({ text: q })).not.toThrow()
    }
    expect(docs.list()).toHaveLength(5)
    expect(buildMatch(['a"b', 'c'])).toBe('"ab" "c"*')
    expect(() => docs.search({ text: 'x'.repeat(201) })).toThrow(/Invalid input/)
    expect(() => docs.search({ text: 'x', limit: 1000 })).toThrow(/Invalid input/)
    closeDatabase(db)
  })

  it('filters by scope and paginates', async () => {
    const { docs, ws, db } = await seeded()
    ws.createItem({ kind: 'note', title: 'Orchid meridian note', body: 'notes about the meridian', url: '', tagLabels: [], projectId: null })
    expect(docs.search({ text: 'meridian', scopes: ['item'] }).results.every((r) => r.type === 'item')).toBe(true)
    expect(docs.search({ text: 'meridian', scopes: ['document'] }).results.every((r) => r.type !== 'item')).toBe(true)
    const all = docs.search({ text: 'meridian' })
    expect(all.total).toBe(3)
    const p1 = docs.search({ text: 'meridian', limit: 2 })
    const p2 = docs.search({ text: 'meridian', limit: 2, offset: 2 })
    expect([...p1.results, ...p2.results].map((r) => `${r.type}${r.id}${'page' in r ? r.page : ''}`)).toEqual(
      all.results.map((r) => `${r.type}${r.id}${'page' in r ? r.page : ''}`)
    )
    closeDatabase(db)
  })

  it('indexes note titles and bodies and keeps them in step with edits and deletes', async () => {
    const { docs, ws, db } = setup()
    const c = ws.createItem({ kind: 'note', title: 'Lighthouse budget', body: 'Persian: نگهداری فانوس', url: '', tagLabels: [], projectId: null })
    const id = c.items[0]!.id
    expect(docs.search({ text: 'lighthouse' }).results[0]).toMatchObject({ type: 'item', id, itemKind: 'note' })
    expect(docs.search({ text: 'فانوس' }).results[0]).toMatchObject({ type: 'item', id })
    ws.updateItem(id, { body: 'replaced text only' })
    expect(docs.search({ text: 'فانوس' }).total).toBe(0)
    expect(docs.search({ text: 'replaced' }).total).toBe(1)
    ws.deleteItem(id)
    expect(docs.search({ text: 'lighthouse' }).total).toBe(0)
    closeDatabase(db)
  })

  it('builds snippets from the original text with exact highlight ranges', () => {
    const s = makeSnippet('Hello   World,\nthe ZEPHYR quartz', ['zephyr'])
    expect(s.text).toBe('Hello World, the ZEPHYR quartz')
    expect(s.marks.map(([a, b]) => s.text.slice(a, b))).toEqual(['ZEPHYR'])
    const long = makeSnippet(`${'x '.repeat(200)}target word ${'y '.repeat(200)}`, ['target'])
    expect(long.text.startsWith('…')).toBe(true)
    expect(long.text.endsWith('…')).toBe(true)
    expect(long.marks.map(([a, b]) => long.text.slice(a, b))).toEqual(['target'])
  })
})

describe('persistence, lifecycle and index integrity', () => {
  it('keeps documents, pages and the index across a reconnect', async () => {
    const a = setup()
    const [r] = await importFiles(a.docs, fixture('sample-multipage.pdf'))
    closeDatabase(a.db)
    const b = setup()
    expect(b.docs.get(idOf(r!))).toMatchObject({ status: 'indexed', pageCount: 5 })
    expect(b.docs.getPage({ id: idOf(r!), page: 3 }).text).toContain('zephyr quartz')
    expect(pages(b.docs.search({ text: 'zephyr' }).results)[0]!.page).toBe(3)
    closeDatabase(b.db)
  })

  it('recovers an import interrupted by a crash: never shown as indexed, retry works', async () => {
    const a = setup()
    let release!: () => void
    a.extract.mockImplementationOnce((p) => new Promise((res) => (release = () => res(pdfFromFile(p)))))
    picks = [fixture('sample-text-pdf.pdf')]
    const r = await a.docs.importDocuments()
    const id = idOf(!r.cancelled ? r.results[0]! : (null as never))
    await vi.waitFor(() => expect(a.docs.get(id).status).toBe('processing'))
    closeDatabase(a.db) // "crash" mid-extraction
    release()
    await a.docs.idle().catch(() => undefined)

    const b = setup()
    expect(b.docs.get(id).status).toBe('processing')
    const rec = await b.docs.recover()
    expect(rec.interrupted).toBe(1)
    expect(b.docs.get(id)).toMatchObject({ status: 'failed', error: 'interrupted' })
    expect(b.docs.search({ text: 'amber' }).results.filter((x) => x.type === 'page')).toEqual([])
    expect(await b.docs.reprocess(id)).toMatchObject({ status: 'indexed', error: null })
    expect(pages(b.docs.search({ text: 'amber' }).results)).toHaveLength(1)
    closeDatabase(b.db)
  })

  it('reprocessing replaces pages atomically without duplicates', async () => {
    const { docs, db } = setup()
    const [r] = await importFiles(docs, fixture('sample-multipage.pdf'))
    const id = idOf(r!)
    await docs.reprocess(id)
    await docs.reprocess(id)
    expect((db.prepare('SELECT COUNT(*) AS n FROM document_pages WHERE document_id = ?').get(id) as { n: number }).n).toBe(5)
    expect(pages(docs.search({ text: 'orchid' }).results)).toHaveLength(2)
    expect(docs.search({ text: 'multipage' }).results.filter((x) => x.type === 'document')).toHaveLength(1)
    closeDatabase(db)
  })

  it('a failed reprocess keeps the previous text searchable and reports the error', async () => {
    const { docs, db, extract } = setup()
    const [r] = await importFiles(docs, fixture('sample-text-pdf.pdf'))
    const id = idOf(r!)
    extract.mockRejectedValueOnce(new ExtractError('corrupt'))
    expect(await docs.reprocess(id)).toMatchObject({ status: 'indexed', error: 'corrupt' })
    expect(pages(docs.search({ text: 'amber' }).results)).toHaveLength(1)
    closeDatabase(db)
  })

  it('a first-time failure is never marked indexed', async () => {
    const { docs, db, extract } = setup()
    extract.mockRejectedValueOnce(new Error('boom'))
    const [r] = await importFiles(docs, fixture('sample-text-pdf.pdf'))
    expect(docs.get(idOf(r!))).toMatchObject({ status: 'failed', error: 'internal' })
    expect(docs.search({ text: 'amber' }).results.filter((x) => x.type === 'page')).toEqual([])
    closeDatabase(db)
  })

  it('removal deletes rows, index entries and only the managed copy', async () => {
    const { docs, db } = setup()
    const before = sha(fixture('sample-multipage.pdf'))
    const [r] = await importFiles(docs, fixture('sample-multipage.pdf'))
    const id = idOf(r!)
    expect(await docs.remove(id)).toEqual({ removed: true, fileDeleted: true })
    expect(docs.list()).toEqual([])
    expect(readdirSync(docsDir)).toEqual([])
    expect(docs.search({ text: 'zephyr' }).total).toBe(0)
    expect(docs.search({ text: 'multipage' }).total).toBe(0)
    expect((db.prepare('SELECT COUNT(*) AS n FROM document_pages').get() as { n: number }).n).toBe(0)
    expect(existsSync(fixture('sample-multipage.pdf'))).toBe(true)
    expect(sha(fixture('sample-multipage.pdf'))).toBe(before)
    await expect(docs.remove(id)).rejects.toMatchObject({ code: 'not_found' })
    closeDatabase(db)
  })

  it('a missing managed copy is reported instead of pretending the file is usable', async () => {
    const { docs, db } = setup()
    const [r] = await importFiles(docs, fixture('sample-document.txt'))
    const id = idOf(r!)
    for (const f of readdirSync(docsDir)) require('node:fs').unlinkSync(join(docsDir, f))
    await docs.recover()
    expect(docs.get(id).error).toBe('missing_file')
    expect(await docs.reprocess(id)).toMatchObject({ status: 'indexed', error: 'missing_file' })
    closeDatabase(db)
  })

  it('start-up recovery deletes orphaned managed copies only', async () => {
    const { docs, db } = setup()
    const orphan = 'doc-00000000-0000-4000-8000-000000000000.pdf'
    writeFileSync(join(docsDir, orphan), '%PDF-')
    writeFileSync(join(docsDir, 'user-note.txt'), 'not ours')
    expect((await docs.recover()).orphansRemoved).toBe(1)
    expect(readdirSync(docsDir)).toEqual(['user-note.txt'])
    closeDatabase(db)
  })

  it('rebuilds the index from authoritative tables and fixes a damaged index', async () => {
    const { docs, ws, db } = setup()
    await importFiles(docs, fixture('sample-multipage.pdf'), fixture('sample-document.md'))
    ws.createItem({ kind: 'idea', title: 'Saffron idea', body: '', url: '', tagLabels: [], projectId: null })
    const snapshot = JSON.stringify(docs.search({ text: 'saffron orchid zephyr' }))
    const counts = () => (db.prepare('SELECT COUNT(*) AS n FROM search_index').get() as { n: number }).n
    const n = counts()
    db.exec("DELETE FROM search_index WHERE kind = 'page'")
    db.exec("INSERT INTO search_index (title, body, kind, ref_id, page) VALUES ('stale', 'stale ghost', 'page', 'doc-gone', 1)")
    expect(docs.rebuildIndex()).toEqual({ entries: n })
    expect(docs.search({ text: 'ghost' }).total).toBe(0)
    expect(JSON.stringify(docs.search({ text: 'saffron orchid zephyr' }))).toBe(snapshot)
    closeDatabase(db)
  })

  it('backfills existing notes into the index on first start after the migration', async () => {
    const { db, ws } = setup()
    ws.createItem({ kind: 'note', title: 'Granite archive', body: 'old note', url: '', tagLabels: [], projectId: null })
    db.exec('DELETE FROM search_index') // as right after migration 0003 on a Phase 3 database
    closeDatabase(db)
    const b = setup()
    const items = (b.db.prepare('SELECT COUNT(*) AS n FROM items').get() as { n: number }).n
    expect(items).toBeGreaterThan(0)
    expect((await b.docs.recover()).rebuilt).toBe(true)
    expect(b.docs.search({ text: 'granite archive', scopes: ['item'] }).total).toBe(1)
    closeDatabase(b.db)
  })
})

describe('migration 0003 on a Phase 3 database', () => {
  it('adds the document tables, keeps every existing row, and makes old notes searchable', async () => {
    const phase3 = openDatabase(tmp.file, { migrations: MIGRATIONS.filter((m) => m.version <= 2) })
    // Phase 3 code had no search index, so write rows the way it stored them.
    phase3.exec(`INSERT INTO projects (id, name, status, created_at, updated_at) VALUES ('proj-a', 'Alpha', 'active', 't', 't');
      INSERT INTO items (id, kind, title, body, project_id, search_text, created_at, updated_at)
      VALUES ('item-a', 'note', 'Basalt ledger', 'kept from phase three', 'proj-a', 'basalt ledger kept from phase three', 't', 't')`)
    const dump = (d: typeof phase3) => JSON.stringify([d.prepare('SELECT * FROM projects').all(), d.prepare('SELECT * FROM items').all()])
    const before = dump(phase3)
    closeDatabase(phase3)

    const { db, docs } = setup()
    expect(currentSchemaVersion(db)).toBe(MIGRATIONS.at(-1)!.version) // 0003 and later
    expect(dump(db)).toBe(before)
    expect((await docs.recover()).rebuilt).toBe(true)
    expect(docs.search({ text: 'basalt' }).results[0]).toMatchObject({ type: 'item' })
    closeDatabase(db)
  })
})

describe('IPC surface', () => {
  it('import takes no arguments, so a renderer-supplied path is ignored', async () => {
    const { docs, db } = setup()
    const select = vi.fn(async () => null)
    const svc = createDocumentService({ db, dir: docsDir, selectFiles: select, extractPdf: pdfFromFile })
    const handlers = documentHandlers(() => svc)
    const h = handlers[IpcChannel.importDocuments]!
    expect(h.length).toBe(0)
    // registerDocumentIpc forwards args.slice(0, handler.length): nothing.
    const r = await toResultAsync(() => h(...['/etc/passwd'].slice(0, h.length)))
    expect(r).toEqual({ ok: true, value: { cancelled: true } })
    expect(select).toHaveBeenCalledWith()
    expect(docs.list()).toEqual([])
    closeDatabase(db)
  })

  it('validates ids and page requests and returns typed errors', async () => {
    const { docs, db } = setup()
    const h = documentHandlers(() => docs)
    expect(await toResultAsync(() => h[IpcChannel.getDocument]!('../../etc'))).toMatchObject({ ok: false, error: { code: 'validation' } })
    expect(await toResultAsync(() => h[IpcChannel.getDocumentPage]!({ id: 'doc-x', page: 0 }))).toMatchObject({ ok: false, error: { code: 'validation' } })
    expect(await toResultAsync(() => h[IpcChannel.removeDocument]!('doc-00000000-0000-4000-8000-000000000000'))).toMatchObject({ ok: false, error: { code: 'not_found' } })
    expect(await toResultAsync(() => h[IpcChannel.search]!({ text: 'x', sql: 'SELECT 1' }))).toMatchObject({ ok: false, error: { code: 'validation' } })
    closeDatabase(db)
  })
})

describe('Phase 9: searchNormalize ASCII fast path', () => {
  it('matches the offset-mapped normaliser on ASCII input', async () => {
    const { searchNormalize, normalizeMapped } = await import('@shared/search-text')
    const chars = ['a', 'B', 'z', 'Q', '1', ' ', ' ', '\t', '\n', '\r\n', '-', '.', '\x00', '\x1f', '\x0b', 'é'.normalize('NFD')[1]!]
    let seed = 7
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    for (let n = 0; n < 500; n++) {
      const s = Array.from({ length: Math.floor(rnd() * 40) }, () => chars[Math.floor(rnd() * chars.length)]!).join('')
      expect(searchNormalize(s)).toBe(normalizeMapped(s).text)
    }
  })
})
