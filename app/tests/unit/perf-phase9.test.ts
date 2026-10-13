// @vitest-environment node
/**
 * Phase 9 measurements on a SYNTHETIC database in a temp folder (never userData).
 * Skipped unless run explicitly:
 *   MINDSPACE_PERF=1 [PERF_NOTES=5000 PERF_DOCS=300] npx vitest run tests/unit/perf-phase9.test.ts
 * Prints dataset size and timings; no document text is logged.
 */
import { it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir, cpus } from 'node:os'
import { join } from 'node:path'
import { closeDatabase, openDatabase } from '../../src/main/db/connection'
import { createWorkspaceService } from '../../src/main/services/workspace-service'
import { createSearchRepo } from '../../src/main/db/repositories/search'

const N = Number(process.env['PERF_NOTES'] ?? 5000)
const D = Number(process.env['PERF_DOCS'] ?? 300)
const words = 'memory project decision archive budget lighthouse orchid saffron roadmap report meeting research design review sprint vendor contract invoice policy security backup restore semantic search model'.split(' ')
const rnd = (i: number, n: number) => Array.from({ length: n }, (_, k) => words[(i * 7 + k * 13 + (k * i) % 5) % words.length]).join(' ')
const ms = (t: number) => `${(performance.now() - t).toFixed(1)} ms`
it.skipIf(!process.env['MINDSPACE_PERF'])('perf', () => {
const dir = mkdtempSync(join(tmpdir(), 'ms-perf-'))
try {
  let t = performance.now()
  const db = openDatabase(join(dir, 'p.sqlite3'))
  console.log('empty DB open + migrations:', ms(t))
  const ws = createWorkspaceService(db)
  t = performance.now()
  db.transaction(() => {
    for (let i = 0; i < N; i++) ws.createItem({ kind: 'note', title: `Note ${i} ${rnd(i, 3)}`, body: rnd(i, 120), url: '', tagLabels: i % 10 === 0 ? ['t' + (i % 50)] : [], projectId: null })
  })()
  console.log(`insert ${N} notes:`, ms(t))
  const idx = createSearchRepo(db)
  t = performance.now()
  db.transaction(() => {
    for (let d = 0; d < D; d++) {
      const id = `doc-perf-${d}`
      db.prepare("INSERT INTO documents (id,title,file_name,format,mime_type,stored_name,content_hash,size_bytes,status,imported_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(id, `Doc ${d}`, `d${d}.txt`, 'txt', 'text/plain', `${id}.txt`, String(d).padStart(64, "0"), 100, 'indexed', '2026-01-01', '2026-01-01')
      idx.indexDocument({ id, title: `Doc ${d}`, fileName: `d${d}.txt` }, Array.from({ length: 20 }, (_, p) => ({ page: p + 1, text: rnd(d * 20 + p, 300) })))
    }
  })()
  console.log(`index ${D} docs x 20 pages:`, ms(t))
  closeDatabase(db)

  t = performance.now()
  const db2 = openDatabase(join(dir, 'p.sqlite3'))
  console.log('reopen DB (quick_check + migrations check):', ms(t))
  const ws2 = createWorkspaceService(db2)
  const idx2 = createSearchRepo(db2)
  const time = (label: string, f: () => unknown, n = 20) => {
    f()
    const t0 = performance.now()
    for (let i = 0; i < n; i++) f()
    console.log(`${label}: ${((performance.now() - t0) / n).toFixed(2)} ms/op`)
  }
  time('FTS search "budget lighthouse"', () => idx2.search('budget lighthouse', ['item', 'document'], 20, 0))
  time('FTS search single rare term', () => idx2.search('vendor', ['item', 'document'], 20, 0))
  time('FTS page 10 (offset 180)', () => idx2.search('memory', ['item', 'document'], 20, 180))
  time('items search (LIKE path)', () => ws2.searchItems({ text: 'lighthouse' }), 5)
  time('loadWorkspace (all lists)', () => ws2.loadWorkspace(), 5)
    t = performance.now()
  idx2.rebuild()
  console.log('rebuild FTS index:', ms(t))
  closeDatabase(db2)
  console.log(`env: node ${process.version}, ${cpus()[0]?.model}, ${cpus().length} cpus; dataset ${N} notes, ${D} docs x 20 pages`)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
}, 600000)
