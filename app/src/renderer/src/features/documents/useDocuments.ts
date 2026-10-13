import { useCallback, useEffect, useRef, useState } from 'react'
import type { DocumentSummary } from '@shared/documents'
import { unwrapResult, useDocumentsApi } from '@/state/documents'

type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; docs: DocumentSummary[] }

/** Document list from the database. Polls only while something is being processed. */
export function useDocumentList() {
  const api = useDocumentsApi()
  const [state, setState] = useState<State>({ status: 'loading' })
  const alive = useRef(true)

  const refresh = useCallback(async () => {
    if (!api) return
    try {
      const docs = await unwrapResult(api.list())
      if (alive.current) setState({ status: 'ready', docs })
    } catch {
      if (alive.current) setState((s) => (s.status === 'ready' ? s : { status: 'error' }))
    }
  }, [api])

  useEffect(() => {
    alive.current = true
    void refresh()
    return () => {
      alive.current = false
    }
  }, [refresh])

  const busy = state.status === 'ready' && state.docs.some((d) => d.status === 'processing' || d.status === 'imported')
  useEffect(() => {
    if (!busy) return
    const timer = setInterval(() => void refresh(), 800)
    return () => clearInterval(timer)
  }, [busy, refresh])

  return { api, state, refresh }
}
