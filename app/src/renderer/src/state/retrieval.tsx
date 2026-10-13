import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { RetrievalBridge, SemanticStatus } from '@shared/retrieval'
import { unwrapResult } from './documents'

/** Retrieval API; defaults to the preload bridge. Tests inject one backed by a temporary database. */
const RetrievalContext = createContext<RetrievalBridge | null>(null)

export function defaultRetrievalApi(): RetrievalBridge | null {
  return typeof window !== 'undefined' ? (window.mindspace?.retrieval ?? null) : null
}

export function RetrievalProvider({ api, children }: { api: RetrievalBridge | null; children: ReactNode }) {
  return <RetrievalContext.Provider value={api}>{children}</RetrievalContext.Provider>
}

export const useRetrievalApi = () => useContext(RetrievalContext)

const BUSY = new Set(['downloading', 'verifying', 'loading'])

/** Model + index status, refreshed while something is in progress. */
export function useSemanticStatus(): { status: SemanticStatus | null; refresh: () => void; setup: () => Promise<void>; rebuild: () => Promise<void> } {
  const api = useRetrievalApi()
  const [status, setStatus] = useState<SemanticStatus | null>(null)
  const refresh = useCallback(() => {
    if (!api) return
    unwrapResult(api.status()).then(setStatus, () => undefined)
  }, [api])
  useEffect(refresh, [refresh])
  const busy = !!status && (BUSY.has(status.model.state) || status.index.state === 'indexing')
  useEffect(() => {
    if (!busy) return
    const timer = setInterval(refresh, 700)
    return () => clearInterval(timer)
  }, [busy, refresh])
  const setup = useCallback(async () => {
    if (!api) return
    const pending = unwrapResult(api.setupModel()).then(setStatus)
    // Poll while the download runs; setupModel resolves when it is done.
    setTimeout(refresh, 100)
    await pending.catch(() => refresh())
  }, [api, refresh])
  const rebuild = useCallback(async () => {
    if (!api) return
    await unwrapResult(api.rebuildIndex()).then(setStatus, () => refresh())
  }, [api, refresh])
  return { status, refresh, setup, rebuild }
}
