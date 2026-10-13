/**
 * DETERMINISTIC MOCK embeddings for unit tests of the pipeline (chunking,
 * storage, ranking, grounding). Words map to hand-picked "concept" axes so
 * synonyms in English and Persian land close together. This proves nothing
 * about the real model; real-model behaviour is tested in
 * semantic-real.test.ts.
 */
import type { EmbedKind, EmbeddingProvider } from '../../../src/main/semantic/provider'
import { EmbeddingError } from '../../../src/main/semantic/provider'

const CONCEPTS: string[][] = [
  ['car', 'cars', 'automobile', 'vehicle', 'vehicles', 'خودرو', 'ماشین'],
  ['budget', 'cost', 'costs', 'expense', 'expenses', 'money', 'هزینه', 'بودجه'],
  ['sleep', 'rest', 'insomnia', 'خواب'],
  ['garden', 'plants', 'tomato', 'tomatoes', 'باغ', 'گیاه'],
  ['database', 'sqlite', 'storage', 'پایگاه'],
  ['travel', 'trip', 'journey', 'سفر'],
  ['lantern', 'lamp', 'light', 'چراغ'],
  ['book', 'books', 'کتاب', 'كتاب']
]
export const MOCK_DIMS = 16

function axisFor(word: string): number | null {
  const i = CONCEPTS.findIndex((c) => c.includes(word))
  return i >= 0 ? i : null
}

export function mockVector(text: string): Float32Array {
  const v = new Float32Array(MOCK_DIMS)
  for (const w of text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
    const a = axisFor(w)
    if (a !== null) v[a]! += 1
    else {
      let h = 0
      for (const ch of w) h = (h * 31 + ch.codePointAt(0)!) >>> 0
      v[8 + (h % 8)]! += 0.15
    }
  }
  let n = Math.hypot(...v)
  if (n === 0) {
    v[15] = 1
    n = 1
  }
  for (let i = 0; i < v.length; i++) v[i] = v[i]! / n
  return v
}

export class MockProvider implements EmbeddingProvider {
  info = { modelId: 'mock-concepts/v1', dimensions: MOCK_DIMS, maxTokens: 512 }
  calls: { texts: string[]; kind: EmbedKind }[] = []
  failOn: ((text: string) => boolean) | null = null
  initError: EmbeddingError | null = null
  /** Resolves embed() calls only when released, to simulate slow inference. */
  gate: Promise<void> | null = null
  closed = false

  constructor(modelId?: string) {
    if (modelId) this.info = { ...this.info, modelId }
  }
  async init() {
    if (this.initError) throw this.initError
  }
  async embed(texts: string[], kind: EmbedKind) {
    if (this.closed) throw new EmbeddingError('closed')
    this.calls.push({ texts, kind })
    if (this.gate) await this.gate
    if (this.failOn && texts.some(this.failOn)) throw new EmbeddingError('inference_failed')
    return texts.map(mockVector)
  }
  async close() {
    this.closed = true
  }
  get embedded() {
    return this.calls.filter((c) => c.kind === 'passage').reduce((n, c) => n + c.texts.length, 0)
  }
}
