/**
 * Phase 5 facade used by IPC: model setup/status, incremental indexing and
 * retrieval. Owns one provider instance per run (lazy model load), the
 * vector index cache and the indexer loop.
 */
import type { Database } from 'better-sqlite3'
import { retrievalQuerySchema } from '@shared/retrieval-contracts'
import type { ModelError, ModelState, RetrievalResponse, SemanticStatus } from '@shared/retrieval'
import { createSearchRepo } from '../db/repositories/search'
import { createSemanticRepo } from '../db/repositories/semantic'
import { DataError } from '../services/workspace-service'
import { createIndexer } from './indexer'
import { E5_MODEL } from './model-manifest'
import { ModelStoreError, type ModelStore } from './model-store'
import { EmbeddingError, type EmbeddingProvider } from './provider'
import { createRetrieval, type SemanticTuning } from './retrieval'
import { createVectorIndex, type VectorIndex } from './vector-index'

export interface SemanticServiceDeps {
  db: Database
  store: ModelStore
  /** Creates the provider for an installed model folder (worker-backed in the app). */
  createProvider: (dir: string) => EmbeddingProvider
  /** Static description of the model the store holds. */
  model?: { modelId: string; displayName: string; license: string; dimensions: number; source: string }
  tuning?: Partial<SemanticTuning>
  debounceMs?: number
  now?: () => Date
}

export function createSemanticService(deps: SemanticServiceDeps) {
  const model = deps.model ?? {
    modelId: E5_MODEL.modelId,
    displayName: E5_MODEL.displayName,
    license: E5_MODEL.license,
    dimensions: E5_MODEL.dimensions,
    source: `https://huggingface.co/${E5_MODEL.repo}`
  }
  const repo = createSemanticRepo(deps.db)
  let provider: EmbeddingProvider | null = null
  let vectors: VectorIndex | null = null
  let state: ModelState = 'missing'
  let error: ModelError | null = null
  let bytesDone = 0
  let setup: Promise<void> | null = null

  const indexer = createIndexer({
    repo,
    provider: () => provider,
    onCommit: () => vectors?.invalidate(),
    ...(deps.debounceMs !== undefined ? { debounceMs: deps.debounceMs } : {}),
    ...(deps.now ? { now: deps.now } : {})
  })
  const retrieval = createRetrieval({
    repo,
    search: createSearchRepo(deps.db),
    provider: () => provider,
    vectors: () => vectors,
    indexIncomplete: () => indexer.busy || (provider ? repo.work(provider.info.modelId).todo.length > 0 : false),
    ...(deps.tuning ? { tuning: deps.tuning } : {})
  })

  /** Loads the model from disk (no network). */
  async function load(): Promise<void> {
    state = 'loading'
    const p = deps.createProvider(deps.store.dir)
    try {
      await p.init()
      if (p.info.dimensions !== model.dimensions || p.info.modelId !== model.modelId) throw new EmbeddingError('load_failed', 'model metadata mismatch')
    } catch (err) {
      console.error('[semantic] model load failed', err)
      await p.close().catch(() => undefined)
      state = 'error'
      error = 'load_failed'
      return
    }
    provider = p
    vectors = createVectorIndex(repo, p.info.modelId, p.info.dimensions)
    state = 'loaded'
    error = null
    void indexer.run()
  }

  const status = (): SemanticStatus => ({
    model: {
      modelId: model.modelId,
      displayName: model.displayName,
      license: model.license,
      dimensions: model.dimensions,
      state,
      error,
      bytesTotal: deps.store.totalBytes,
      bytesDone: state === 'downloading' ? bytesDone : 0,
      source: model.source
    },
    index: indexer.status(provider ? provider.info.modelId : null)
  })

  return {
    status,
    /** Start-up: if the model is already installed, load it and catch up on indexing. Never downloads. */
    async start(): Promise<void> {
      if (await deps.store.isInstalled()) await load()
      else state = 'missing'
    },
    /** Explicit user action. Downloads only if files are missing or invalid. */
    async setupModel(): Promise<SemanticStatus> {
      if (provider) return status()
      setup ??= (async () => {
        error = null
        try {
          if (!(await deps.store.isInstalled())) {
            state = 'verifying'
            if (!(await deps.store.verify())) {
              state = 'downloading'
              bytesDone = 0
              await deps.store.download((n) => (bytesDone = n))
            }
          }
        } catch (err) {
          state = 'error'
          error = err instanceof ModelStoreError ? err.code : 'internal'
          if (!(err instanceof ModelStoreError)) console.error('[semantic] setup failed', err)
          return
        }
        await load()
      })().finally(() => (setup = null))
      await setup
      return status()
    },
    async rebuildIndex(): Promise<SemanticStatus> {
      if (!provider) throw new DataError('unavailable', 'The local embedding model is not set up')
      void indexer.rebuild()
      return status()
    },
    async retrieve(query: unknown): Promise<RetrievalResponse> {
      const r = retrievalQuerySchema.safeParse(query)
      if (!r.success) throw new DataError('validation', 'Invalid input')
      return retrieval.retrieve(r.data.text, r.data.mode ?? 'hybrid', r.data.scopes, r.data.limit ?? 10)
    },
    /** Call after any content change (note edit, import, reprocess, delete). */
    notifyChanged: () => {
      vectors?.invalidate()
      indexer.schedule()
    },
    /** Test hook: resolves when indexing is idle. */
    idle: () => indexer.run(),
    async close(): Promise<void> {
      await indexer.stop()
      await provider?.close().catch(() => undefined)
      provider = null
      vectors = null
    }
  }
}
export type SemanticService = ReturnType<typeof createSemanticService>
