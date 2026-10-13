/**
 * Measures the REAL model on the synthetic evaluation set (no app, no database):
 *   MINDSPACE_MODEL_DIR=<model folder> npx tsx scripts/semantic-eval.mts
 * Prints, per query, the expected note's rank and score, the best wrong score,
 * and summary numbers used to choose SEMANTIC_TUNING.
 */
import { OnnxE5Provider } from '../src/main/semantic/onnx-e5-provider'
import { passageText } from '../src/main/semantic/indexer'
import { itemUnitText } from '../src/main/db/repositories/semantic'
import { EVAL_NOTES, EVAL_QUERIES } from '../tests/unit/helpers/semantic-eval'

const dir = process.env['MINDSPACE_MODEL_DIR']
if (!dir) throw new Error('Set MINDSPACE_MODEL_DIR')
const p = new OnnxE5Provider({ dir })
await p.init()
const dot = (a: Float32Array, b: Float32Array) => a.reduce((s, x, i) => s + x * b[i]!, 0)
const texts = EVAL_NOTES.map((n) => passageText(n.title, itemUnitText({ title: n.title, body: n.body, url: null })))
let t = performance.now()
const pv = await p.embed(texts, 'passage')
console.log(`embedded ${texts.length} notes in ${(performance.now() - t).toFixed(0)} ms`)
const rows: { kind: string; rank: number | null; score: number | null; top: number; wrong: number }[] = []
t = performance.now()
for (const e of EVAL_QUERIES) {
  const [qv] = await p.embed([e.q], 'query')
  const scored = EVAL_NOTES.map((n, i) => ({ key: n.key, s: dot(qv!, pv[i]!) })).sort((a, b) => b.s - a.s)
  const rank = e.expect ? scored.findIndex((x) => x.key === e.expect) + 1 : null
  const score = e.expect ? scored.find((x) => x.key === e.expect)!.s : null
  const wrong = Math.max(...scored.filter((x) => x.key !== e.expect).map((x) => x.s))
  rows.push({ kind: e.kind, rank, score, top: scored[0]!.s, wrong })
  console.log(`${e.kind.padEnd(6)} rank=${String(rank ?? '-').padEnd(2)} score=${score?.toFixed(3) ?? '  -  '} top=${scored[0]!.key.padEnd(9)} ${scored[0]!.s.toFixed(3)} bestWrong=${wrong.toFixed(3)}  ${e.q}`)
}
console.log(`queries: ${EVAL_QUERIES.length} in ${(performance.now() - t).toFixed(0)} ms`)
for (const kind of ['en-en', 'fa-fa', 'fa-en', 'en-fa']) {
  const r = rows.filter((x) => x.kind === kind)
  const top1 = r.filter((x) => x.rank === 1).length
  const mrr = r.reduce((s, x) => s + 1 / x.rank!, 0) / r.length
  console.log(`${kind}: top1 ${top1}/${r.length}  MRR ${mrr.toFixed(2)}  min correct score ${Math.min(...r.map((x) => x.score!)).toFixed(3)}`)
}
const neg = rows.filter((x) => x.kind === 'none')
console.log(`no-answer queries: max score ${Math.max(...neg.map((x) => x.top)).toFixed(3)}`)
await p.close()
