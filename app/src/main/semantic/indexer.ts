/**
 * Incremental semantic indexing. One simple local loop, no job queue:
 *
 *   reconcile: compare every indexable source (items, documents with text)
 *     with semantic_sources by updated_at and model id.
 *   for each source that may have changed: read its text through the repo →
 *     hash it → if the hash and model are unchanged, just record the new
 *     version → otherwise chunk, embed (in the provider's worker), validate
 *     → ONE transaction replaces its chunks. Until that commit the previous
 *     chunks stay searchable.
 *
 * Nothing is marked done before its commit, so a shutdown mid-run simply
 * leaves those sources "to do" for the next start. Unchanged content is
 * never re-embedded. Deleted sources are removed by FK cascade at deletion.
 */
import type { IndexStatus } from '@shared/retrieval'
import { chunkId, type SemanticRepo, type SourceSnapshot, type StoredChunk } from '../db/repositories/semantic'
import { chunkText, type ChunkOptions } from './chunker'
import { EmbeddingError, type EmbeddingProvider } from './provider'

export interface IndexerDeps {
  repo: SemanticRepo
  /** Null while the model is not installed/loaded: indexing waits. */
  provider: () => EmbeddingProvider | null
  /** Called after every commit so the vector index reloads. */
  onCommit?: () => void
  chunk?: Partial<ChunkOptions>
  /** Inputs per embed() call; keeps memory bounded and lets shutdown stop between batches. */
  batchSize?: number
  now?: () => Date
  /** Delay before a scheduled pass, to coalesce bursts of edits. */
  debounceMs?: number
}

/** Text actually embedded for a chunk: the source title gives the passage its context. */
export function passageText(title: string, chunk: string): string {
  const t = title.trim()
  return t && !chunk.startsWith(t) ? `${t}\n${chunk}` : chunk
}

export function createIndexer(deps: IndexerDeps) {
  const { repo } = deps
  const now = deps.now ?? (() => new Date())
  const batchSize = deps.batchSize ?? 16
  let running: Promise<void> | null = null
  let again = false
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const progress = { pending: 0, done: 0, failed: 0 }

  /** Chunks + embeddings for one snapshot. Throws EmbeddingError on model problems. */
  async function build(s: SourceSnapshot, provider: EmbeddingProvider): Promise<StoredChunk[]> {
    const ranges: { page: number | null; start: number; end: number; text: string }[] = []
    for (const u of s.units) {
      for (const r of chunkText(u.text, deps.chunk)) ranges.push({ page: u.page, start: r.start, end: r.end, text: u.text.slice(r.start, r.end) })
    }
    const { modelId } = provider.info
    const out: StoredChunk[] = []
    for (let i = 0; i < ranges.length; i += batchSize) {
      if (stopped) throw new EmbeddingError('closed')
      const batch = ranges.slice(i, i + batchSize)
      const vectors = await provider.embed(batch.map((r) => passageText(s.title, r.text)), 'passage')
      batch.forEach((r, j) => {
        out.push({ id: chunkId(s.key, r.page, r.start, r.end, r.text, modelId), page: r.page, ordinal: i + j, start: r.start, end: r.end, text: r.text, embedding: vectors[j]! })
      })
    }
    return out
  }

  async function pass(): Promise<void> {
    const provider = deps.provider()
    if (!provider) return
    const { modelId, dimensions } = provider.info
    const plan = repo.work(modelId)
    for (const key of plan.stale) repo.remove(key)
    if (plan.stale.length) deps.onCommit?.()
    progress.pending = plan.todo.length
    progress.done = 0
    progress.failed = 0
    for (const w of plan.todo) {
      if (stopped || deps.provider() !== provider) return
      const s = repo.snapshot(w.type, w.id)
      progress.pending--
      if (!s) continue // removed or no longer indexable meanwhile; cascade/stale cleanup handles rows
      const stored = repo.stored(s.key)
      if (stored && stored.model_id === modelId && stored.content_hash === s.hash && stored.status === 'ready') {
        repo.touch(s.key, s.version)
        progress.done++
        continue
      }
      try {
        const chunks = await build(s, provider)
        if (stopped) return // shutting down: never write after close() started
        // Staged commit: only if the source did not change while we were embedding.
        if (repo.currentVersion(s.type, s.id) !== s.version) {
          again = true
          continue
        }
        repo.replace(s, modelId, dimensions, chunks, now().toISOString())
        progress.done++
        deps.onCommit?.()
      } catch (err) {
        if (err instanceof EmbeddingError && (err.code === 'closed' || err.code === 'load_failed' || err.code === 'model_missing')) {
          // The model went away: stop without recording anything; the next pass retries.
          return
        }
        console.error('[semantic] indexing failed for', s.key, err)
        progress.failed++
        if (repo.currentVersion(s.type, s.id) === s.version) {
          repo.fail(s, modelId, err instanceof EmbeddingError ? err.code : 'internal', now().toISOString())
          deps.onCommit?.()
        }
      }
    }
  }

  function run(): Promise<void> {
    if (running) {
      again = true
      return running
    }
    running = (async () => {
      do {
        again = false
        await pass()
      } while (again && !stopped)
    })().finally(() => {
      running = null
      progress.pending = 0
    })
    return running
  }

  return {
    /** Runs a pass now (or after the current one). Resolves when indexing is idle. */
    run,
    /** Debounced run, for use after edits. */
    schedule(): void {
      if (stopped) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void run()
      }, deps.debounceMs ?? 400)
    },
    /** Drops all stored vectors and re-embeds everything. */
    async rebuild(): Promise<void> {
      await running
      repo.clear()
      deps.onCommit?.()
      await run()
    },
    retryFailed(): Promise<void> {
      repo.retryFailed()
      return run()
    },
    status(modelId: string | null): IndexStatus {
      const counts = repo.counts()
      const plan = modelId ? repo.work(modelId) : null
      return {
        state: running ? 'indexing' : deps.provider() ? 'idle' : 'paused',
        pending: running ? progress.pending : (plan?.todo.length ?? 0),
        done: progress.done,
        failed: plan?.failed ?? 0,
        sources: counts.sources,
        chunks: counts.chunks,
        outdated: plan?.outdated ?? 0
      }
    },
    /** Stops between batches; the unfinished source is not committed. */
    async stop(): Promise<void> {
      stopped = true
      if (timer) clearTimeout(timer)
      await running?.catch(() => undefined)
    },
    get busy() {
      return running !== null
    }
  }
}
export type Indexer = ReturnType<typeof createIndexer>
