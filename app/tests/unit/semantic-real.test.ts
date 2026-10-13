// @vitest-environment node
/**
 * Phase 5 tests against the REAL local embedding model
 * (multilingual-e5-small, int8 ONNX, pinned revision). They need the model
 * files, which are not in the repository (~118 MB):
 *
 *   MINDSPACE_TEST_MODEL_DIR=<folder with the pinned files> npx vitest run tests/unit/semantic-real.test.ts
 *
 * Without that variable the whole file is SKIPPED (reported as skipped, never
 * as passed). Nothing here uses mock vectors.
 */
import { copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDatabase, openDatabase } from '../../src/main/db/connection'
import { extractPdf } from '../../src/main/documents/extract'
import { E5_MODEL } from '../../src/main/semantic/model-manifest'
import { createModelStore } from '../../src/main/semantic/model-store'
import { OnnxE5Provider } from '../../src/main/semantic/onnx-e5-provider'
import { EmbeddingError } from '../../src/main/semantic/provider'
import { createSemanticService } from '../../src/main/semantic/semantic-service'
import { createDocumentService } from '../../src/main/services/document-service'
import { createWorkspaceService } from '../../src/main/services/workspace-service'
import type { RetrievalResponse } from '@shared/retrieval'
import { EVAL_NOTES, EVAL_QUERIES } from './helpers/semantic-eval'
import { tempDir } from './helpers/db'

const MODEL_DIR = process.env['MINDSPACE_TEST_MODEL_DIR']
const FIX = resolve(__dirname, '../fixtures/documents')
const dot = (a: Float32Array, b: Float32Array) => a.reduce((s, x, i) => s + x * b[i]!, 0)

describe.skipIf(!MODEL_DIR)('real embedding model', () => {
  let provider: OnnxE5Provider
  beforeAll(async () => {
    provider = new OnnxE5Provider({ dir: MODEL_DIR! })
    const t = performance.now()
    await provider.init()
    console.info(`[real] model load ${(performance.now() - t).toFixed(0)} ms`)
  }, 60_000)
  afterAll(() => provider?.close())

  it('the installed files match the pinned revision and checksums', async () => {
    expect(await createModelStore(MODEL_DIR!).verify()).toBe(true)
    expect(provider.info).toEqual({ modelId: E5_MODEL.modelId, dimensions: 384, maxTokens: 512 })
    expect(E5_MODEL.modelId).toContain(E5_MODEL.revision.slice(0, 12))
  })

  it('produces valid, normalised, deterministic 384-dimensional vectors for English, Persian and mixed text', async () => {
    const texts = ['A short English sentence.', 'یک جمله‌ی کوتاه فارسی.', 'Mixed متن with پروژه alpha-seven', 'x']
    const a = await provider.embed(texts, 'passage')
    const b = await provider.embed(texts, 'passage')
    for (let i = 0; i < texts.length; i++) {
      expect(a[i]!.length).toBe(384)
      expect(Math.abs(Math.hypot(...a[i]!) - 1)).toBeLessThan(1e-4)
      expect(a[i]!.every(Number.isFinite)).toBe(true)
      expect(Array.from(a[i]!)).toEqual(Array.from(b[i]!))
    }
    // Not a constant or random function of the input.
    expect(dot(a[0]!, a[1]!)).toBeLessThan(0.99)
  })

  it('gives a text the same vector whatever it is embedded with (no batch effects)', async () => {
    const [alone] = await provider.embed(['The automobile needs new tyres.'], 'passage')
    const batch = await provider.embed(['The automobile needs new tyres.', 'A much longer sentence that would force padding of the shorter one.'], 'passage')
    expect(Array.from(batch[0]!)).toEqual(Array.from(alone!))
  })

  it('truncates very long input to the model limit instead of failing', async () => {
    const long = 'word '.repeat(5000)
    const [v] = await provider.embed([long], 'passage')
    expect(v!.length).toBe(384)
  })

  it('reports a missing or broken model with a typed error', async () => {
    const tmp = tempDir()
    try {
      await expect(new OnnxE5Provider({ dir: join(tmp.dir, 'nothing') }).init()).rejects.toMatchObject({ code: 'model_missing' })
      const broken = join(tmp.dir, 'broken')
      mkdirSync(join(broken, 'onnx'), { recursive: true })
      for (const f of ['tokenizer.json', 'tokenizer_config.json', 'config.json']) copyFileSync(join(MODEL_DIR!, f), join(broken, f))
      writeFileSync(join(broken, E5_MODEL.onnxFile), 'not an onnx model')
      const p = new OnnxE5Provider({ dir: broken })
      await expect(p.init()).rejects.toBeInstanceOf(EmbeddingError)
      await expect(p.init()).rejects.toMatchObject({ code: 'load_failed' })
      // A tampered file fails checksum verification.
      expect(await createModelStore(broken).verify()).toBe(false)
    } finally {
      tmp.cleanup()
    }
  })
})

describe.skipIf(!MODEL_DIR)('real-model retrieval end to end', () => {
  let tmp: ReturnType<typeof tempDir>
  let db: ReturnType<typeof openDatabase>
  let sem: ReturnType<typeof createSemanticService>
  let docs: ReturnType<typeof createDocumentService>
  const ids = new Map<string, string>()
  let pdfId = ''

  beforeAll(async () => {
    tmp = tempDir()
    // The real model folder is copied so verification and the marker file never touch the original.
    const modelCopy = join(tmp.dir, 'model')
    cpSync(MODEL_DIR!, modelCopy, { recursive: true })
    db = openDatabase(tmp.file)
    const store = createModelStore(modelCopy)
    expect(await store.verify()).toBe(true)
    sem = createSemanticService({ db, store, createProvider: (dir) => new OnnxE5Provider({ dir }), debounceMs: 0 })
    const ws = createWorkspaceService(db)
    for (const n of EVAL_NOTES) ids.set(ws.createItem({ kind: 'note', title: n.title, body: n.body, url: '', tagLabels: [], projectId: null }).items[0]!.id, n.key)
    const dir = join(tmp.dir, 'documents')
    mkdirSync(dir)
    docs = createDocumentService({
      db,
      dir,
      selectFiles: async () => [join(FIX, 'sample-semantic.pdf'), join(FIX, 'sample-multipage.pdf')],
      extractPdf: async (p) => extractPdf(new Uint8Array(readFileSync(p))),
      onChange: () => sem.notifyChanged()
    })
    const r = await docs.importDocuments()
    await docs.idle()
    if (r.cancelled || r.results[0]!.outcome !== 'imported') throw new Error('fixture import failed')
    pdfId = r.results[0]!.document.id
    const t = performance.now()
    await sem.start()
    await sem.idle()
    const n = (db.prepare('SELECT COUNT(*) AS n FROM semantic_chunks').get() as { n: number }).n
    console.info(`[real] indexed ${EVAL_NOTES.length} notes + 2 PDFs → ${n} chunks in ${(performance.now() - t).toFixed(0)} ms`)
    expect(sem.status().model.state).toBe('loaded')
  }, 120_000)
  afterAll(async () => {
    await sem?.close()
    if (db) closeDatabase(db)
    tmp?.cleanup()
  })

  const ask = (text: string, mode: 'semantic' | 'hybrid' | 'keyword' = 'semantic', scopes?: ('item' | 'document')[]) =>
    sem.retrieve({ text, mode, ...(scopes ? { scopes } : {}) }) as Promise<RetrievalResponse>

  it('finds the right note by meaning; reports per-language results', async () => {
    const byKind = new Map<string, { top1: number; n: number }>()
    const misses: string[] = []
    let worst = 0
    for (const e of EVAL_QUERIES.filter((x) => x.expect)) {
      const t = performance.now()
      const r = await ask(e.q, 'semantic', ['item'])
      worst = Math.max(worst, performance.now() - t)
      const top = r.results[0]?.source.id
      const ok = !!top && ids.get(top) === e.expect
      const k = byKind.get(e.kind) ?? { top1: 0, n: 0 }
      byKind.set(e.kind, { top1: k.top1 + (ok ? 1 : 0), n: k.n + 1 })
      if (!ok) misses.push(`${e.kind}: "${e.q}" → ${top ? ids.get(top) : 'nothing'}`)
    }
    console.info('[real] top-1 by direction', Object.fromEntries(byKind), 'misses', misses, `slowest query ${worst.toFixed(0)} ms`)
    // Verified claims (see ADR 0005): same-language and English→Persian work on this set...
    expect(byKind.get('en-en')).toEqual({ top1: 7, n: 7 })
    expect(byKind.get('fa-fa')).toEqual({ top1: 5, n: 5 })
    expect(byKind.get('en-fa')).toEqual({ top1: 4, n: 4 })
    // ...Persian→English is weak with this small model: at least one of three, documented as a limitation.
    expect(byKind.get('fa-en')!.top1).toBeGreaterThanOrEqual(1)
  })

  it('returns no evidence for unrelated English questions; logs the Persian one (known limitation)', async () => {
    for (const e of EVAL_QUERIES.filter((x) => !x.expect && x.q.match(/[a-z]/))) {
      const r = await ask(e.q, 'semantic')
      expect(r.results, e.q).toEqual([])
    }
    // Persian queries score higher against Persian text in general. Observed: the unrelated
    // "فیزیک ذرات بنیادی" still returns the one Persian PDF page just above the floor.
    // This is recorded in ADR 0005, not hidden; the floor is not tuned to this one case.
    const fa = await ask('فیزیک ذرات بنیادی', 'semantic')
    console.info('[real] unrelated Persian query →', fa.results.map((r) => `${r.source.title} p${r.source.type === 'document' ? r.source.page : '-'} ${r.similarity?.toFixed(3)}`))
    expect(fa.results.length).toBeLessThanOrEqual(1)
  })

  it('cites the correct PDF page for paraphrased questions, with an excerpt from that page', async () => {
    const cases: [string, number][] = [
      ['replacing brakes on my vehicle before a snowy journey', 2],
      ['insomnia and caffeine', 3],
      ['یکسان کردن حروف عربی و فارسی در جست‌وجو', 4]
    ]
    for (const [q, page] of cases) {
      const r = await ask(q, 'semantic', ['document'])
      const hit = r.results[0]
      expect(hit?.source, q).toMatchObject({ type: 'document', id: pdfId, page, format: 'pdf' })
      const pageText = (db.prepare('SELECT text FROM document_pages WHERE document_id = ? AND page_no = ?').get(pdfId, page) as { text: string }).text
      const chunk = db.prepare('SELECT text, page FROM semantic_chunks WHERE id = ?').get(hit!.chunkId) as { text: string; page: number }
      expect(chunk.page).toBe(page)
      expect(pageText).toContain(chunk.text)
    }
  })

  it('hybrid keeps exact identifiers first and adds meaning-based matches', async () => {
    const exact = await ask('nDCG@10', 'hybrid')
    expect(ids.get(exact.results[0]!.source.id)).toBe('thesis')
    expect(exact.results[0]!.methods).toContain('keyword')
    const para = await ask('car maintenance before winter', 'hybrid')
    const keys = para.results.map((r) => (r.source.type === 'item' ? ids.get(r.source.id) : `pdf:${r.source.page}`))
    expect(keys.slice(0, 3)).toEqual(expect.arrayContaining(['car', 'pdf:2']))
    // Phase 4 keyword behaviour is unchanged.
    const kw = await ask('zephyr quartz', 'keyword')
    expect(kw.results[0]!.source).toMatchObject({ page: 3 })
  })

  it('a deleted source disappears from semantic results immediately', async () => {
    const before = await ask('trouble sleeping through the night', 'semantic', ['item'])
    const id = before.results[0]!.source.id
    createWorkspaceService(db).deleteItem(id)
    const after = await ask('trouble sleeping through the night', 'semantic', ['item'])
    expect(after.results.map((r) => r.source.id)).not.toContain(id)
  })
})
