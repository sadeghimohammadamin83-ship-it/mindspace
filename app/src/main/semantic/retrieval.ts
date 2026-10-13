/**
 * Semantic and hybrid retrieval over the local knowledge base.
 *
 * keyword  = the Phase 4 FTS5 search, unchanged.
 * semantic = query embedding (same model as the stored vectors) → exact
 *            cosine top-k → threshold → one best chunk per source location →
 *            at most a few locations per source → verified against the
 *            CURRENT stored text.
 * hybrid   = both lists fused with reciprocal rank fusion (RRF, k = 60) at the
 *            level of source locations (a note, a document title, one page).
 *            RRF uses ranks only, so BM25 and cosine scales are never mixed.
 *
 * Grounding: every result is re-read from items / documents / document_pages
 * at query time. A semantic chunk is returned only if its stored text is
 * still exactly the text at its offsets in the current source, so a deleted
 * or edited source can never produce a stale citation or page number.
 */
import type { SearchResult, SearchScope, Snippet } from '@shared/documents'
import type { RetrievalMethod, RetrievalMode, RetrievalResponse, RetrievalResult, RetrievalScope, RetrievalSource } from '@shared/retrieval'
import { RETRIEVAL_SCOPES } from '@shared/retrieval'
import { queryTerms } from '@shared/search-text'
import type { SearchRepo } from '../db/repositories/search'
import { itemUnitText, type SemanticRepo } from '../db/repositories/semantic'
import type { EmbeddingProvider } from './provider'
import type { VectorIndex } from './vector-index'

/**
 * Measured on the real model (multilingual-e5-small, int8) with the synthetic
 * set in tests/unit/helpers/semantic-eval.ts (scripts/semantic-eval.mts, ADR 0005):
 * e5 similarities are compressed (unrelated text still scores 0.70–0.80), the
 * highest no-answer query scored 0.799 against the notes and the lowest correct
 * top-1 hit 0.822. The floor sits between them; the margin drops the long tail
 * under a strong best hit. Persian queries score higher against Persian text
 * in general (an unrelated Persian query reached 0.819 on a Persian PDF page),
 * so the floor is not a guarantee. These are raw cosines, not probabilities.
 */
export interface SemanticTuning {
  /** Absolute cosine floor. */
  minScore: number
  /** Drop hits more than this below the best hit. */
  margin: number
  /** Chunks considered before grouping. */
  candidates: number
  /** Max locations (pages) returned per source. */
  perSource: number
  /** Reciprocal rank fusion constant. */
  rrfK: number
}

export const SEMANTIC_TUNING: SemanticTuning = {
  minScore: 0.81,
  margin: 0.05,
  candidates: 60,
  perSource: 3,
  rrfK: 60
}

const EXCERPT_CHARS = 280

export interface RetrievalDeps {
  repo: SemanticRepo
  search: SearchRepo
  provider: () => EmbeddingProvider | null
  vectors: () => VectorIndex | null
  indexIncomplete: () => boolean
  tuning?: Partial<SemanticTuning>
}

interface Candidate {
  key: string
  source: RetrievalSource
  chunkId: string | null
  excerpt: Snippet
  similarity: number | null
}

/** A plain excerpt of the original chunk text (whitespace collapsed, bounded). */
export function chunkExcerpt(text: string, max = EXCERPT_CHARS): Snippet {
  const flat = text.replace(/\s+/g, ' ').trim()
  return { text: flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat, marks: [] }
}

const scopeOfKey = (key: string): RetrievalScope => (key.startsWith('item:') ? 'item' : 'document')

export function createRetrieval(deps: RetrievalDeps) {
  const tuning = { ...SEMANTIC_TUNING, ...deps.tuning }

  function lexical(text: string, scopes: readonly RetrievalScope[], limit: number): Candidate[] {
    const r = deps.search.search(text, scopes as SearchScope[], limit, 0)
    return r.results.map((x: SearchResult): Candidate => {
      if (x.type === 'item') return { key: `item:${x.id}`, source: { type: 'item', id: x.id, itemKind: x.itemKind, title: x.title }, chunkId: null, excerpt: x.snippet, similarity: null }
      const page = x.type === 'page' && x.format === 'pdf' ? x.page : null
      return {
        key: x.type === 'page' ? `page:${x.id}:${x.page}` : `doc:${x.id}`,
        source: { type: 'document', id: x.id, title: x.title, fileName: x.fileName, format: x.format, page },
        chunkId: null,
        excerpt: x.snippet,
        similarity: null
      }
    })
  }

  /** Resolves a chunk to its live source; null when the source is gone or its text changed. */
  function resolve(chunkId: string, score: number): Candidate | null {
    const c = deps.repo.chunk(chunkId)
    if (!c) return null
    const [type, id] = [c.source_key.slice(0, c.source_key.indexOf(':')), c.source_key.slice(c.source_key.indexOf(':') + 1)]
    if (type === 'item') {
      const i = deps.repo.item(id)
      if (!i || itemUnitText(i).slice(c.char_start, c.char_end) !== c.text) return null
      return { key: `item:${id}`, source: { type: 'item', id, itemKind: i.kind, title: i.title }, chunkId, excerpt: chunkExcerpt(c.text), similarity: score }
    }
    const d = deps.repo.document(id)
    if (!d || c.page === null) return null
    const pageText = deps.repo.pageText(id, c.page)
    if (pageText === null || pageText.slice(c.char_start, c.char_end) !== c.text) return null
    return {
      key: `page:${id}:${c.page}`,
      source: { type: 'document', id, title: d.title, fileName: d.file_name, format: d.format, page: d.format === 'pdf' ? c.page : null },
      chunkId,
      excerpt: chunkExcerpt(c.text),
      similarity: score
    }
  }

  async function semantic(text: string, scopes: readonly RetrievalScope[], limit: number): Promise<Candidate[] | null> {
    const provider = deps.provider()
    const vectors = deps.vectors()
    if (!provider || !vectors) return null
    let q: Float32Array
    try {
      ;[q] = (await provider.embed([text], 'query')) as [Float32Array]
    } catch (err) {
      console.error('[semantic] query embedding failed', err)
      return null
    }
    const allowed = new Set(scopes)
    const hits = vectors.search(q, tuning.candidates, tuning.minScore, (key) => allowed.has(scopeOfKey(key)))
    if (!hits.length) return []
    const floor = hits[0]!.score - tuning.margin
    const out: Candidate[] = []
    const seen = new Set<string>()
    const perSource = new Map<string, number>()
    for (const h of hits) {
      if (h.score < floor) break
      const c = resolve(h.chunkId, h.score)
      if (!c || seen.has(c.key)) continue // one (best) chunk per location: drops overlapping chunks
      const n = perSource.get(h.sourceKey) ?? 0
      if (n >= tuning.perSource) continue // source diversity
      perSource.set(h.sourceKey, n + 1)
      seen.add(c.key)
      out.push(c)
      if (out.length >= limit) break
    }
    return out
  }

  return {
    async retrieve(text: string, mode: RetrievalMode, scopes: readonly RetrievalScope[] = RETRIEVAL_SCOPES, limit = 10): Promise<RetrievalResponse> {
      const query = text.trim()
      const wantSemantic = mode !== 'keyword'
      const empty: RetrievalResponse = { mode, results: [], semantic: wantSemantic ? 'ok' : 'not_requested', indexIncomplete: false }
      if (!query || !scopes.length) return empty
      const kw = mode === 'semantic' || !queryTerms(query).length ? [] : lexical(query, scopes, Math.max(limit, 20))
      const sem = wantSemantic ? await semantic(query, scopes, Math.max(limit, 20)) : []
      const semanticState = !wantSemantic ? 'not_requested' : sem === null ? 'model_unavailable' : 'ok'

      // Reciprocal rank fusion over source locations.
      const fused = new Map<string, Candidate & { score: number; methods: RetrievalMethod[]; kwRank: number }>()
      const add = (list: Candidate[], method: RetrievalMethod) =>
        list.forEach((c, i) => {
          const contribution = 1 / (tuning.rrfK + i + 1)
          const f = fused.get(c.key)
          if (!f) {
            fused.set(c.key, { ...c, score: contribution, methods: [method], kwRank: method === 'keyword' ? i : Infinity })
            return
          }
          f.score += contribution
          f.methods.push(method)
          if (method === 'semantic') {
            f.chunkId = c.chunkId
            f.similarity = c.similarity
          }
        })
      add(kw, 'keyword')
      add(sem ?? [], 'semantic')
      const ranked = [...fused.values()].sort(
        (a, b) => b.score - a.score || a.kwRank - b.kwRank || (b.similarity ?? 0) - (a.similarity ?? 0) || a.key.localeCompare(b.key)
      )
      const results: RetrievalResult[] = ranked.slice(0, limit).map((r, i) => ({
        key: r.key,
        source: r.source,
        chunkId: r.chunkId,
        // Keyword snippets carry highlight ranges; semantic-only hits show the chunk itself.
        excerpt: r.excerpt,
        methods: r.methods,
        rank: i + 1,
        similarity: r.similarity
      }))
      return { mode, results, semantic: semanticState, indexIncomplete: wantSemantic && deps.indexIncomplete() }
    }
  }
}
export type Retrieval = ReturnType<typeof createRetrieval>
