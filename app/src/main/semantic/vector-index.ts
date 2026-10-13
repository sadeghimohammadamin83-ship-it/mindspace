/**
 * Exact (brute-force) cosine search over the stored vectors of one model,
 * held in a single contiguous Float32Array in the main process. Vectors are
 * L2-normalised, so cosine similarity is a dot product.
 *
 * Why not sqlite-vec: it is a pre-1.0 native SQLite extension that must be
 * loaded into better-sqlite3 inside Electron and shipped per platform; for
 * the expected desktop dataset (thousands to low tens of thousands of chunks)
 * an exact scan is a few milliseconds and has no extra native dependency.
 * Cost: 384 floats x 4 bytes = 1.5 KB of RAM per chunk (50 000 chunks ≈ 77 MB),
 * and time grows linearly. MAX_VECTORS bounds memory; see ADR 0005.
 */
import { fromBlob, type SemanticRepo } from '../db/repositories/semantic'

export const MAX_VECTORS = 200_000

export interface VectorHit {
  chunkId: string
  sourceKey: string
  page: number | null
  score: number
}

export function createVectorIndex(repo: SemanticRepo, modelId: string, dimensions: number) {
  let loaded: { ids: string[]; keys: string[]; pages: (number | null)[]; matrix: Float32Array } | null = null
  let truncated = false

  function load() {
    const ids: string[] = []
    const keys: string[] = []
    const pages: (number | null)[] = []
    let matrix = new Float32Array(1024 * dimensions)
    truncated = false
    for (const row of repo.vectors(modelId)) {
      if (ids.length >= MAX_VECTORS) {
        truncated = true
        break
      }
      const v = fromBlob(row.embedding)
      if (v.length !== dimensions) continue // never compare vectors of a different shape
      if ((ids.length + 1) * dimensions > matrix.length) {
        const bigger = new Float32Array(matrix.length * 2)
        bigger.set(matrix)
        matrix = bigger
      }
      matrix.set(v, ids.length * dimensions)
      ids.push(row.id)
      keys.push(row.source_key)
      pages.push(row.page)
    }
    loaded = { ids, keys, pages, matrix }
    return loaded
  }

  return {
    /** Call after any write to semantic_chunks; the next search reloads. */
    invalidate: () => void (loaded = null),
    get size() {
      return (loaded ?? load()).ids.length
    },
    get truncated() {
      return truncated
    },
    /**
     * Top `k` chunks with similarity >= `minScore`, best first. `accept`
     * filters by source key (content-type filters).
     */
    search(query: Float32Array, k: number, minScore: number, accept: (sourceKey: string) => boolean = () => true): VectorHit[] {
      if (query.length !== dimensions) throw new Error('query vector has wrong dimensions')
      const { ids, keys, pages, matrix } = loaded ?? load()
      const top: VectorHit[] = []
      for (let r = 0; r < ids.length; r++) {
        let dot = 0
        const base = r * dimensions
        for (let d = 0; d < dimensions; d++) dot += matrix[base + d]! * query[d]!
        if (dot < minScore) continue
        if (top.length === k && dot <= top[k - 1]!.score) continue
        if (!accept(keys[r]!)) continue
        const hit = { chunkId: ids[r]!, sourceKey: keys[r]!, page: pages[r]!, score: dot }
        let i = top.length
        if (top.length < k) top.push(hit)
        else i = k - 1
        while (i > 0 && top[i - 1]!.score < dot) {
          top[i] = top[i - 1]!
          i--
        }
        top[i] = hit
      }
      return top
    }
  }
}
export type VectorIndex = ReturnType<typeof createVectorIndex>
