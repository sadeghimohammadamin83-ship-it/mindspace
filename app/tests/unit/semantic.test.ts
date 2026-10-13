// @vitest-environment node
/**
 * Phase 5 pipeline tests with DETERMINISTIC MOCK embeddings (see
 * helpers/mock-embeddings.ts): chunking, storage, incremental indexing,
 * recovery, ranking, hybrid fusion and source grounding. These do not show
 * that the real model works; semantic-real.test.ts does that.
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, openDatabase } from '../../src/main/db/connection'
import { currentSchemaVersion, MIGRATIONS } from '../../src/main/db/migrations'
import { createSemanticRepo, fromBlob, itemUnitText, toBlob } from '../../src/main/db/repositories/semantic'
import { extractPdf } from '../../src/main/documents/extract'
import { semanticHandlers } from '../../src/main/ipc/semantic-handlers'
import { toResultAsync } from '../../src/main/ipc/document-handlers'
import { chunkText } from '../../src/main/semantic/chunker'
import { embedNormalize } from '../../src/main/semantic/embed-text'
import { createIndexer, passageText } from '../../src/main/semantic/indexer'
import { EmbeddingError, validateVectors } from '../../src/main/semantic/provider'
import { createSemanticService } from '../../src/main/semantic/semantic-service'
import { createDocumentService } from '../../src/main/services/document-service'
import { createWorkspaceService } from '../../src/main/services/workspace-service'
import type { ModelStore } from '../../src/main/semantic/model-store'
import { IpcChannel } from '@shared/ipc'
import type { RetrievalResponse } from '@shared/retrieval'
import { tempDir } from './helpers/db'
import { MOCK_DIMS, MockProvider, mockVector } from './helpers/mock-embeddings'

const FIX = resolve(__dirname, '../fixtures/documents')

let tmp: ReturnType<typeof tempDir>
let docsDir: string
let picks: string[] | null
beforeEach(() => {
  tmp = tempDir()
  docsDir = join(tmp.dir, 'documents')
  mkdirSync(docsDir)
  picks = null
})
const open: { db: ReturnType<typeof openDatabase>; sem: { close(): Promise<void> } }[] = []
/** Stops indexing before the connection closes (as the app does on quit). */
async function shut(db: ReturnType<typeof openDatabase>) {
  for (const o of open.filter((x) => x.db === db)) await o.sem.close()
  closeDatabase(db)
}
afterEach(async () => {
  for (const o of open.splice(0)) {
    await o.sem.close()
    closeDatabase(o.db)
  }
  tmp.cleanup()
})

const installedStore: ModelStore = {
  dir: '/nonexistent',
  totalBytes: 0,
  isInstalled: async () => true,
  verify: async () => true,
  download: async () => undefined
}

function setup(opts: { provider?: MockProvider; file?: string } = {}) {
  const db = openDatabase(opts.file ?? tmp.file)
  const provider = opts.provider ?? new MockProvider()
  const sem = createSemanticService({
    db,
    store: installedStore,
    createProvider: () => provider,
    model: { modelId: provider.info.modelId, displayName: 'mock', license: 'test', dimensions: MOCK_DIMS, source: 'test' },
    // Mock vectors have their own scale; tuned for the mock only.
    tuning: { minScore: 0.5, margin: 0.5 },
    debounceMs: 0
  })
  const ws = createWorkspaceService(db)
  const docs = createDocumentService({
    db,
    dir: docsDir,
    selectFiles: async () => picks,
    extractPdf: async (p) => extractPdf(new Uint8Array(readFileSync(p))),
    onChange: () => sem.notifyChanged()
  })
  open.push({ db, sem })
  return { db, sem, ws, docs, provider }
}

async function addNote(ws: ReturnType<typeof createWorkspaceService>, title: string, body: string) {
  const c = ws.createItem({ kind: 'note', title, body, url: '', tagLabels: [], projectId: null })
  return c.items[0]!.id
}

async function importFixtures(docs: ReturnType<typeof setup>['docs'], ...names: string[]) {
  picks = names.map((n) => join(FIX, n))
  const r = await docs.importDocuments()
  await docs.idle()
  if (r.cancelled) throw new Error('cancelled')
  return r.results.map((x) => (x.outcome === 'rejected' ? '' : x.document.id))
}

const ask = (sem: ReturnType<typeof setup>['sem'], text: string, mode: 'hybrid' | 'keyword' | 'semantic' = 'hybrid', extra = {}) =>
  sem.retrieve({ text, mode, ...extra }) as Promise<RetrievalResponse>

describe('chunking', () => {
  it('keeps a short note as one chunk and never emits empty chunks', () => {
    expect(chunkText('Hello world.')).toEqual([{ start: 0, end: 12 }])
    expect(chunkText('')).toEqual([])
    expect(chunkText('  \n\n --- \n\n ... ')).toEqual([])
  })
  it('splits long text on paragraph and sentence boundaries within the size limit, with overlap', () => {
    const para = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} talks about something.`).join(' ')
    const text = `# Heading\n\n${para}\n\nTail paragraph.`
    const chunks = chunkText(text, { maxChars: 300, overlapChars: 80 })
    expect(chunks.length).toBeGreaterThan(4)
    for (const c of chunks) {
      expect(c.end - c.start).toBeLessThanOrEqual(300)
      const t = text.slice(c.start, c.end)
      expect(t.trim()).toBe(t)
      expect(t.length).toBeGreaterThan(0)
    }
    // Heading stays with the text it introduces; sentence pieces end at sentence ends.
    expect(text.slice(chunks[0]!.start, chunks[0]!.end)).toMatch(/^# Heading\n\nSentence number 0/)
    expect(text.slice(chunks[1]!.start, chunks[1]!.end)).toMatch(/^Sentence number \d+ .*\.$/s)
    // Consecutive pieces of one paragraph overlap.
    expect(chunks[1]!.start).toBeLessThan(chunks[0]!.end)
    expect(text.slice(chunks.at(-1)!.start, chunks.at(-1)!.end)).toContain('Tail paragraph.')
  })
  it('opens a new chunk at each heading and keeps paragraph boundaries', () => {
    const text = '# A\n\nalpha text\n\n## B\n\nbeta text'
    expect(chunkText(text).map((c) => text.slice(c.start, c.end))).toEqual(['# A\n\nalpha text', '## B\n\nbeta text'])
  })
  it('handles Persian sentences and punctuation (؟ ؛) and long words without losing text', () => {
    const fa = Array.from({ length: 30 }, (_, i) => `این جمله‌ی شماره ${i} درباره‌ی پروژه است؟ بله؛ درست است.`).join(' ')
    const chunks = chunkText(fa, { maxChars: 200, overlapChars: 40 })
    expect(chunks.length).toBeGreaterThan(5)
    const covered = new Set<number>()
    for (const c of chunks) for (let i = c.start; i < c.end; i++) covered.add(i)
    for (let i = 0; i < fa.length; i++) if (fa[i] !== ' ') expect(covered.has(i)).toBe(true)
    const long = 'x'.repeat(1000)
    expect(chunkText(long, { maxChars: 300, overlapChars: 50 }).every((c) => c.end - c.start <= 300)).toBe(true)
  })
  it('is deterministic and drops exact duplicate chunks within one unit', () => {
    const same = 'The same repeated paragraph, word for word.'
    const t = `${same}\n\n${same}\n\nA different closing paragraph.`
    expect(chunkText(t, { maxChars: 60, overlapChars: 10 })).toEqual(chunkText(t, { maxChars: 60, overlapChars: 10 }))
    expect(chunkText(t, { maxChars: 60, overlapChars: 10 }).map((c) => t.slice(c.start, c.end))).toEqual([same, 'A different closing paragraph.'])
  })
  it('rejects invalid options', () => {
    expect(() => chunkText('x', { maxChars: 10 })).toThrow()
    expect(() => chunkText('x', { maxChars: 100, overlapChars: 60 })).toThrow()
  })
})

describe('embedding text and vectors', () => {
  it('normalises Persian variants for embedding without touching stored text', () => {
    expect(embedNormalize('كتابي  مُفيد')).toBe('کتابی مفید')
    expect(embedNormalize('می‌خواهم')).toBe('می‌خواهم') // ZWNJ kept
    expect(embedNormalize('ﻛﺘﺎﺏ')).toBe('کتاب') // presentation forms
  })
  it('validates dimensions, finiteness and normalisation', () => {
    expect(() => validateVectors([mockVector('car')], 1, MOCK_DIMS)).not.toThrow()
    expect(() => validateVectors([new Float32Array(3)], 1, MOCK_DIMS)).toThrow(EmbeddingError)
    expect(() => validateVectors([new Float32Array(MOCK_DIMS).fill(NaN)], 1, MOCK_DIMS)).toThrow(EmbeddingError)
    expect(() => validateVectors([new Float32Array(MOCK_DIMS).fill(1)], 1, MOCK_DIMS)).toThrow(EmbeddingError)
    expect(() => validateVectors([], 1, MOCK_DIMS)).toThrow(EmbeddingError)
  })
  it('stores vectors as exact little-endian float32 blobs', () => {
    const v = mockVector('budget for the car')
    expect(Array.from(fromBlob(toBlob(v)))).toEqual(Array.from(v))
  })
  it('gives each passage its source title as context', () => {
    expect(passageText('Trip plan', 'We leave at 9.')).toBe('Trip plan\nWe leave at 9.')
    expect(passageText('Trip plan', 'Trip plan\n\nbody')).toBe('Trip plan\n\nbody')
  })
})

describe('migration 0004', () => {
  it('adds the semantic tables after 0003', async () => {
    const { db } = setup()
    expect(MIGRATIONS.map((m) => m.version)).toEqual([1, 2, 3, 4, 5])
    expect(currentSchemaVersion(db)).toBe(5)
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name)
    expect(tables).toEqual(expect.arrayContaining(['semantic_sources', 'semantic_chunks', 'search_index', 'documents', 'items']))
    await shut(db)
  })
})

describe('indexing', () => {
  it('indexes notes and document pages with correct source metadata, once', async () => {
    const { db, sem, ws, docs, provider } = setup()
    await sem.start()
    const noteId = await addNote(ws, 'Car costs', 'The automobile insurance renewal is due.')
    const [pdf] = await importFixtures(docs, 'sample-multipage.pdf')
    await sem.idle()
    const rows = db.prepare('SELECT source_key, page, char_start, char_end, text, model_id, dimensions FROM semantic_chunks').all() as {
      source_key: string
      page: number | null
      char_start: number
      char_end: number
      text: string
      model_id: string
      dimensions: number
    }[]
    const note = rows.filter((r) => r.source_key === `item:${noteId}`)
    expect(note).toHaveLength(1)
    expect(note[0]).toMatchObject({ page: null, model_id: 'mock-concepts/v1', dimensions: MOCK_DIMS })
    const item = ws.loadWorkspace().items.find((i) => i.id === noteId)!
    expect(itemUnitText({ ...item, url: null }).slice(note[0]!.char_start, note[0]!.char_end)).toBe(note[0]!.text)
    const pagesIndexed = [...new Set(rows.filter((r) => r.source_key === `document:${pdf}`).map((r) => r.page))].sort()
    expect(pagesIndexed).toEqual([1, 2, 3, 5]) // page 4 is blank: no chunk
    for (const r of rows.filter((x) => x.source_key === `document:${pdf}`)) {
      const page = (db.prepare('SELECT text FROM document_pages WHERE document_id = ? AND page_no = ?').get(pdf, r.page) as { text: string }).text
      expect(page.slice(r.char_start, r.char_end)).toBe(r.text)
    }
    // Indexing again changes nothing and embeds nothing.
    const before = provider.embedded
    const count = rows.length
    await sem.idle()
    expect(provider.embedded).toBe(before)
    expect((db.prepare('SELECT COUNT(*) AS n FROM semantic_chunks').get() as { n: number }).n).toBe(count)
    await shut(db)
  })

  it('re-embeds only a changed note, replacing its chunks without duplicates', async () => {
    const { db, sem, ws, provider } = setup()
    await sem.start()
    const a = await addNote(ws, 'Garden', 'Tomatoes need sun.')
    const b = await addNote(ws, 'Sleep', 'Rest well.')
    await sem.idle()
    const before = provider.embedded
    ws.updateItem(a, { body: 'Tomatoes need water and sun. Plants grow.' })
    await sem.idle()
    expect(provider.embedded - before).toBe(1)
    const texts = (db.prepare('SELECT text FROM semantic_chunks WHERE source_key = ?').all(`item:${a}`) as { text: string }[]).map((r) => r.text)
    expect(texts).toEqual(['Garden\n\nTomatoes need water and sun. Plants grow.'])
    expect((db.prepare('SELECT COUNT(*) AS n FROM semantic_chunks WHERE source_key = ?').get(`item:${b}`) as { n: number }).n).toBe(1)
    await shut(db)
  })

  it('does not re-embed when only metadata moved updated_at', async () => {
    const { db, sem, ws, provider } = setup()
    await sem.start()
    const a = await addNote(ws, 'Garden', 'Tomatoes need sun.')
    await sem.idle()
    const before = provider.embedded
    ws.updateItem(a, { title: 'Garden', body: 'Tomatoes need sun.' })
    db.prepare('UPDATE items SET updated_at = ? WHERE id = ?').run('2030-01-01T00:00:00.000Z', a)
    await sem.idle()
    expect(provider.embedded).toBe(before)
    expect(db.prepare('SELECT source_version FROM semantic_sources WHERE source_key = ?').get(`item:${a}`)).toEqual({ source_version: '2030-01-01T00:00:00.000Z' })
    await shut(db)
  })

  it('removes chunks in the same transaction as the source deletion (notes and documents)', async () => {
    const { db, sem, ws, docs } = setup()
    await sem.start()
    const a = await addNote(ws, 'Car', 'vehicle')
    const [doc] = await importFixtures(docs, 'sample-document.txt')
    await sem.idle()
    ws.deleteItem(a)
    await docs.remove(doc!)
    const left = db.prepare('SELECT source_key FROM semantic_chunks').all() as { source_key: string }[]
    expect(left.filter((r) => r.source_key.endsWith(a) || r.source_key.endsWith(doc!))).toEqual([])
    expect(db.prepare('SELECT COUNT(*) AS n FROM semantic_sources').get()).toEqual({ n: 0 })
    await shut(db)
  })

  it('reprocessing a document keeps old chunks until the new text is committed, then re-indexes', async () => {
    const { db, sem, docs } = setup()
    await sem.start()
    const [doc] = await importFixtures(docs, 'sample-document.md')
    await sem.idle()
    const before = db.prepare('SELECT id FROM semantic_chunks ORDER BY id').all()
    db.prepare("UPDATE documents SET status = 'processing' WHERE id = ?").run(doc)
    await sem.idle()
    expect(db.prepare('SELECT id FROM semantic_chunks ORDER BY id').all()).toEqual(before) // still searchable meanwhile
    await docs.reprocess(doc)
    await sem.idle()
    // Same text → same stable chunk ids, no duplicates.
    expect(db.prepare('SELECT id FROM semantic_chunks ORDER BY id').all()).toEqual(before)
    await shut(db)
  })

  it('an interrupted run is not treated as complete and finishes on the next start', async () => {
    const provider = new MockProvider()
    let release!: () => void
    provider.gate = new Promise((r) => (release = r))
    const { db, sem, ws } = setup({ provider })
    await addNote(ws, 'One', 'car')
    await addNote(ws, 'Two', 'budget')
    await sem.start() // starts indexing, blocked inside embed()
    await new Promise((r) => setTimeout(r, 10))
    const closing = sem.close()
    release()
    await closing
    expect(db.prepare('SELECT COUNT(*) AS n FROM semantic_sources').get()).toEqual({ n: 0 })
    await shut(db)

    const again = setup()
    await again.sem.start()
    await again.sem.idle()
    expect(again.db.prepare("SELECT COUNT(*) AS n FROM semantic_sources WHERE status = 'ready'").get()).toEqual({ n: 2 })
    await shut(again.db)
  })

  it('a source edited while it was being embedded is not committed with stale text', async () => {
    const provider = new MockProvider()
    let release!: () => void
    provider.gate = new Promise((r) => (release = r))
    const { db, sem, ws } = setup({ provider })
    const id = await addNote(ws, 'Draft', 'car')
    await sem.start()
    await new Promise((r) => setTimeout(r, 10))
    ws.updateItem(id, { body: 'budget' })
    db.prepare('UPDATE items SET updated_at = ? WHERE id = ?').run('2031-01-01T00:00:00.000Z', id)
    provider.gate = null
    release()
    await sem.idle()
    const rows = db.prepare('SELECT text FROM semantic_chunks').all()
    expect(rows).toEqual([{ text: 'Draft\n\nbudget' }])
    await shut(db)
  })

  it('records an embedding failure without marking the source ready, and retries when content changes', async () => {
    const provider = new MockProvider()
    provider.failOn = (t) => t.includes('poison')
    const { db, sem, ws } = setup({ provider })
    await sem.start()
    const id = await addNote(ws, 'Bad', 'poison pill')
    await sem.idle()
    expect(db.prepare('SELECT status, last_error, chunk_count FROM semantic_sources').get()).toEqual({ status: 'failed', last_error: 'inference_failed', chunk_count: 0 })
    expect(sem.status().index.failed).toBe(1)
    ws.updateItem(id, { body: 'fine now' })
    await sem.idle()
    expect(db.prepare('SELECT status FROM semantic_sources').get()).toEqual({ status: 'ready' })
    await shut(db)
  })

  it('detects a model change and re-embeds everything with the new model; old vectors are never compared', async () => {
    const first = setup()
    await first.sem.start()
    await addNote(first.ws, 'Car', 'automobile')
    await first.sem.idle()
    await first.sem.close()
    await shut(first.db)

    const v2 = new MockProvider('mock-concepts/v2')
    const { db, sem } = setup({ provider: v2 })
    expect(sem.status().index.outdated).toBe(0) // not loaded yet
    await sem.start()
    await sem.idle()
    expect(db.prepare('SELECT DISTINCT model_id FROM semantic_chunks').all()).toEqual([{ model_id: 'mock-concepts/v2' }])
    expect(v2.embedded).toBe(1)
    await shut(db)
  })

  it('keeps vectors across a reconnect without re-embedding', async () => {
    const a = setup()
    await a.sem.start()
    await addNote(a.ws, 'Sleep', 'insomnia notes')
    await a.sem.idle()
    await a.sem.close()
    await shut(a.db)
    const p = new MockProvider()
    const b = setup({ provider: p })
    await b.sem.start()
    await b.sem.idle()
    expect(p.embedded).toBe(0)
    const r = await ask(b.sem, 'rest', 'semantic')
    expect(r.results[0]?.source).toMatchObject({ type: 'item', title: 'Sleep' })
    await shut(b.db)
  })

  it('rebuild re-embeds everything; retryFailed is explicit', async () => {
    const { db, sem, ws, provider } = setup()
    await sem.start()
    await addNote(ws, 'Car', 'automobile')
    await sem.idle()
    const before = provider.embedded
    await sem.rebuildIndex()
    await sem.idle()
    expect(provider.embedded).toBe(before + 1)
    expect(db.prepare('SELECT COUNT(*) AS n FROM semantic_chunks').get()).toEqual({ n: 1 })
    await shut(db)
  })
})

describe('semantic retrieval (mock vectors)', () => {
  async function seeded() {
    const s = setup()
    await s.sem.start()
    const ids = {
      car: await addNote(s.ws, 'Vehicle upkeep', 'The automobile needs new tyres before winter.'),
      money: await addNote(s.ws, 'Household', 'Monthly expenses and budget review.'),
      garden: await addNote(s.ws, 'Balcony', 'Tomatoes and other plants on the balcony.'),
      fa: await addNote(s.ws, 'یادداشت سفر', 'برنامه‌ی سفر به شیراز در بهار.')
    }
    await s.sem.idle()
    return { ...s, ids }
  }

  it('finds a note that shares no words with the query', async () => {
    const { db, sem, ids } = await seeded()
    const r = await ask(sem, 'car', 'semantic')
    expect(r.semantic).toBe('ok')
    expect(r.results[0]).toMatchObject({ source: { type: 'item', id: ids.car, title: 'Vehicle upkeep' }, methods: ['semantic'], rank: 1 })
    expect(r.results[0]!.excerpt.text).toContain('automobile')
    expect(r.results[0]!.chunkId).toMatch(/^chk-/)
    await shut(db)
  })

  it('returns nothing when no stored passage is close enough', async () => {
    const { db, sem } = await seeded()
    expect((await ask(sem, 'quantum chromodynamics', 'semantic')).results).toEqual([])
    expect((await ask(sem, '   ', 'hybrid')).results).toEqual([])
    await shut(db)
  })

  it('crosses languages when the vectors do (Persian query → English note, English → Persian)', async () => {
    const { db, sem, ids } = await seeded()
    expect((await ask(sem, 'هزینه', 'semantic')).results[0]?.source.id).toBe(ids.money)
    expect((await ask(sem, 'journey', 'semantic')).results[0]?.source.id).toBe(ids.fa)
    await shut(db)
  })

  it('respects top-k and content-type filters', async () => {
    const { db, sem, docs } = await seeded()
    await importFixtures(docs, 'sample-document.txt')
    await sem.idle()
    const onlyDocs = await ask(sem, 'car budget plants', 'semantic', { scopes: ['document'] })
    expect(onlyDocs.results.every((r) => r.source.type === 'document')).toBe(true)
    const one = await ask(sem, 'car budget plants', 'semantic', { limit: 1 })
    expect(one.results).toHaveLength(1)
    await shut(db)
  })

  it('returns one result per location and caps results per source (diversity)', async () => {
    const { db, sem, ws } = setup()
    await sem.start()
    const body = Array.from({ length: 12 }, (_, i) => `Paragraph ${i}: the car and the automobile and the vehicle.`).join('\n\n')
    const id = await addNote(ws, 'Long car note', body)
    await sem.idle()
    expect((db.prepare('SELECT COUNT(*) AS n FROM semantic_chunks').get() as { n: number }).n).toBe(1)
    db.prepare('DELETE FROM semantic_sources').run()
    // Force many chunks for the same note with a small chunk size.
    const repo = createSemanticRepo(db)
    const p = new MockProvider()
    const indexer = createIndexer({ repo, provider: () => p, chunk: { maxChars: 80, overlapChars: 10 } })
    await indexer.run()
    expect((db.prepare('SELECT COUNT(*) AS n FROM semantic_chunks').get() as { n: number }).n).toBeGreaterThan(5)
    const r = await ask(sem, 'vehicle', 'semantic')
    expect(r.results.filter((x) => x.source.id === id)).toHaveLength(1)
    await shut(db)
  })

  it('reports an unavailable model instead of inventing results; hybrid falls back to keywords', async () => {
    const provider = new MockProvider()
    provider.initError = new EmbeddingError('load_failed')
    const { db, sem, ws } = setup({ provider })
    await sem.start()
    expect(sem.status().model).toMatchObject({ state: 'error', error: 'load_failed' })
    await addNote(ws, 'Car', 'automobile tyres')
    const s = await ask(sem, 'automobile', 'semantic')
    expect(s).toMatchObject({ semantic: 'model_unavailable', results: [] })
    const h = await ask(sem, 'automobile', 'hybrid')
    expect(h.semantic).toBe('model_unavailable')
    expect(h.results.map((r) => r.methods)).toEqual([['keyword']])
    await shut(db)
  })
})

describe('hybrid retrieval', () => {
  it('fuses keyword and semantic hits for the same source into one result', async () => {
    const { db, sem, ws } = setup()
    await sem.start()
    const id = await addNote(ws, 'Automobile', 'The automobile needs tyres.')
    await addNote(ws, 'Other', 'vehicle maintenance log') // semantic only
    await sem.idle()
    const r = await ask(sem, 'automobile')
    expect(r.results[0]).toMatchObject({ source: { id }, methods: ['keyword', 'semantic'] })
    expect(r.results[0]!.excerpt.marks.length).toBeGreaterThan(0) // keyword highlight kept
    expect(r.results.filter((x) => x.source.id === id)).toHaveLength(1)
    expect(r.results[1]?.methods).toEqual(['semantic'])
    await shut(db)
  })

  it('ranks an exact identifier/title match first', async () => {
    const { db, sem, ws } = setup()
    await sem.start()
    await addNote(ws, 'Car notes', 'automobile vehicle car car')
    const exact = await addNote(ws, 'ZX-4471 invoice', 'Reference for the car part ZX-4471.')
    await sem.idle()
    const r = await ask(sem, 'ZX-4471')
    expect(r.results[0]!.source.id).toBe(exact)
    expect(r.results[0]!.methods).toContain('keyword')
    await shut(db)
  })

  it('keyword mode reproduces Phase 4 search and never calls the model', async () => {
    const { db, sem, docs, provider } = setup()
    await sem.start()
    const [pdf] = await importFixtures(docs, 'sample-multipage.pdf')
    await sem.idle()
    const calls = provider.calls.length
    const r = await ask(sem, 'zephyr quartz', 'keyword')
    expect(provider.calls.length).toBe(calls)
    expect(r.semantic).toBe('not_requested')
    expect(r.results[0]).toMatchObject({ key: `page:${pdf}:3`, source: { type: 'document', id: pdf, page: 3, format: 'pdf' }, methods: ['keyword'] })
    await shut(db)
  })
})

describe('grounding', () => {
  it('cites the correct PDF document and one-based page with an excerpt from that page', async () => {
    const { db, sem, docs } = setup()
    await sem.start()
    const [pdf] = await importFixtures(docs, 'sample-multipage.pdf')
    await sem.idle()
    const r = await ask(sem, 'zephyr quartz ledger', 'semantic')
    const hit = r.results.find((x) => x.source.type === 'document' && x.source.page === 3)
    expect(hit).toBeTruthy()
    const page3 = (db.prepare('SELECT text FROM document_pages WHERE document_id = ? AND page_no = 3').get(pdf) as { text: string }).text
    const chunk = db.prepare('SELECT text, page FROM semantic_chunks WHERE id = ?').get(hit!.chunkId) as { text: string; page: number }
    expect(chunk.page).toBe(3)
    expect(page3).toContain(chunk.text)
    expect(hit!.excerpt.text.replace('…', '')).toBe(chunk.text.replace(/\s+/g, ' ').trim().slice(0, hit!.excerpt.text.replace('…', '').length))
    await shut(db)
  })

  it('TXT/Markdown hits carry no page number; notes resolve to the note id', async () => {
    const { db, sem, docs, ws } = setup()
    await sem.start()
    const [txt] = await importFixtures(docs, 'sample-document.txt')
    const note = await addNote(ws, 'Lamp', 'The lantern light.')
    await sem.idle()
    const r = await ask(sem, 'lamp light lantern', 'semantic')
    expect(r.results.find((x) => x.source.id === note)?.source).toEqual({ type: 'item', id: note, itemKind: 'note', title: 'Lamp' })
    for (const x of r.results.filter((y) => y.source.id === txt)) expect(x.source).toMatchObject({ page: null, format: 'txt' })
    await shut(db)
  })

  it('never returns a stale citation: edited text that is not re-indexed yet is filtered out', async () => {
    const { db, sem, ws } = setup()
    await sem.start()
    const id = await addNote(ws, 'Vehicle', 'automobile')
    await sem.idle()
    // Change the stored text behind the index's back (no notify): the chunk no longer matches.
    db.prepare("UPDATE items SET body = 'something else entirely' WHERE id = ?").run(id)
    const r = await ask(sem, 'car', 'semantic')
    expect(r.results).toEqual([])
    await shut(db)
  })

  it('never returns a deleted source, even before re-indexing runs', async () => {
    const { db, sem, ws, docs } = setup()
    await sem.start()
    const id = await addNote(ws, 'Vehicle', 'automobile')
    const [pdf] = await importFixtures(docs, 'sample-text-pdf.pdf')
    await sem.idle()
    ws.deleteItem(id)
    await docs.remove(pdf!)
    expect((await ask(sem, 'car', 'semantic')).results).toEqual([])
    expect((await ask(sem, 'lamp lantern', 'hybrid')).results.filter((r) => r.source.id === pdf)).toEqual([])
    await shut(db)
  })
})

describe('IPC surface', () => {
  it('validates retrieval queries and returns typed errors', async () => {
    const { db, sem } = setup()
    await sem.start()
    const h = semanticHandlers(() => sem)
    const call = (ch: string, ...a: unknown[]) => toResultAsync(() => h[ch]!(...a))
    for (const bad of [null, 'text', { text: 1 }, { text: 'x'.repeat(501) }, { text: 'a', mode: 'llm' }, { text: 'a', limit: 0 }, { text: 'a', scopes: [] }, { text: 'a', sql: 'DROP' }]) {
      expect(await call(IpcChannel.retrieve, bad)).toMatchObject({ ok: false, error: { code: 'validation' } })
    }
    expect(await call(IpcChannel.retrieve, { text: "'; DROP TABLE items; --", mode: 'hybrid' })).toMatchObject({ ok: true })
    // Setup takes no argument: a renderer cannot choose a URL or folder.
    expect(h[IpcChannel.semanticSetup]!.length).toBe(0)
    expect(await call(IpcChannel.semanticStatus)).toMatchObject({ ok: true, value: { model: { state: 'loaded' } } })
    await shut(db)
  })
})
