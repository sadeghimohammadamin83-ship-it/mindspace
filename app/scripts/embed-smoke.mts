/**
 * Manual check of the REAL local embedding model (no app, no database):
 *   MINDSPACE_MODEL_DIR=<folder with the pinned model files> npx tsx scripts/embed-smoke.mts
 * Prints load time, vector dimensions and a few cosine similarities.
 */
import { OnnxE5Provider } from '../src/main/semantic/onnx-e5-provider'

const dir = process.env['MINDSPACE_MODEL_DIR']
if (!dir) throw new Error('Set MINDSPACE_MODEL_DIR')
const p = new OnnxE5Provider({ dir })
const t0 = performance.now()
await p.init()
console.log(`load ${(performance.now() - t0).toFixed(0)} ms`)
const dot = (a: Float32Array, b: Float32Array) => a.reduce((s, x, i) => s + x * b[i]!, 0)
const passages = [
  'The automobile needs new tyres before winter.',
  'Monthly household expenses and budget review.',
  'برنامه‌ی سفر به شیراز در بهار.',
  'We chose SQLite because it is a single local file and needs no server.'
]
const t1 = performance.now()
const pv = await p.embed(passages, 'passage')
console.log(`embed ${passages.length} passages ${(performance.now() - t1).toFixed(0)} ms, dims ${pv[0]!.length}`)
for (const q of ['car maintenance', 'هزینه‌های ماهانه', 'trip to Shiraz', 'why a local database?', 'quantum chromodynamics']) {
  const [qv] = await p.embed([q], 'query')
  console.log(q.padEnd(28), pv.map((v) => dot(qv!, v).toFixed(3)).join('  '))
}
await p.close()
