import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { AiBridge, AiErrorCode, AiEvent, AiSettingsView, AnswerSource } from '@shared/ai'
import type { DataResult } from '@shared/ipc'

/** AI API; defaults to the preload bridge. Tests inject one backed by a temporary database. */
export function defaultAiApi(): AiBridge | null {
  return typeof window !== 'undefined' ? (window.mindspace?.ai ?? null) : null
}

/** The answer currently being written. Lives above the pages so leaving Ask and coming back keeps showing it. */
export interface LiveGeneration {
  /** Null for the instant between sending the question and the first event. */
  generationId: string | null
  conversationId: string | null
  question: string
  phase: 'retrieving' | 'generating'
  text: string
  sources: AnswerSource[]
  semanticAvailable: boolean | null
  indexIncomplete: boolean
}

export interface AskFailure {
  code: AiErrorCode | 'unknown'
  message: string
}

interface AiContextValue {
  api: AiBridge | null
  live: LiveGeneration | null
  /** Increments whenever a conversation was created or finished, so views can reload. */
  version: number
  /** The conversation the latest question belongs to, kept after the answer finished (a fast answer can end within one render). */
  started: { conversationId: string; seq: number } | null
  ask(conversationId: string | null, question: string): Promise<AskFailure | null>
  cancel(): void
}

const AiContext = createContext<AiContextValue>({ api: null, live: null, version: 0, started: null, ask: async () => ({ code: 'unknown', message: '' }), cancel: () => undefined })
export const useAi = () => useContext(AiContext)

function failureOf(r: Extract<DataResult<unknown>, { ok: false }>): AskFailure {
  const code = r.error.fields?.['ai']
  return { code: (code as AiErrorCode | undefined) ?? 'unknown', message: r.error.message }
}

export function AiProvider({ api, children }: { api: AiBridge | null; children: ReactNode }) {
  const [live, setLive] = useState<LiveGeneration | null>(null)
  const [version, setVersion] = useState(0)
  const [started, setStarted] = useState<{ conversationId: string; seq: number } | null>(null)
  const liveRef = useRef<LiveGeneration | null>(null)
  const update = useCallback((next: LiveGeneration | null) => {
    liveRef.current = next
    setLive(next)
  }, [])

  useEffect(() => {
    if (!api) return
    const off = api.onEvent((e: AiEvent) => {
      const cur = liveRef.current
      if (!cur) return
      if (e.type === 'started') {
        // The first event of the generation we just asked for binds its id; anything else is ignored.
        if (cur.generationId === null) update({ ...cur, generationId: e.generationId, conversationId: e.conversationId })
        setStarted((p) => ({ conversationId: e.conversationId, seq: (p?.seq ?? 0) + 1 }))
        setVersion((v) => v + 1)
        return
      }
      // Events of any other generation (stale, or from another conversation) never touch the live view.
      if (cur.generationId !== e.generationId) return
      if (e.type === 'retrieved') update({ ...cur, phase: 'generating', sources: e.sources, semanticAvailable: e.semanticAvailable, indexIncomplete: e.indexIncomplete })
      else if (e.type === 'delta') update({ ...cur, phase: 'generating', text: cur.text + e.text })
      else {
        update(null)
        setVersion((v) => v + 1)
      }
    })
    return off
  }, [api, update])

  const ask = useCallback(
    async (conversationId: string | null, question: string): Promise<AskFailure | null> => {
      if (!api || liveRef.current) return { code: 'busy', message: '' }
      update({ generationId: null, conversationId, question, phase: 'retrieving', text: '', sources: [], semanticAvailable: null, indexIncomplete: false })
      try {
        const r = await api.ask({ conversationId, question })
        if (!r.ok) {
          update(null)
          return failureOf(r)
        }
        const cur = liveRef.current as LiveGeneration | null
        // The generation may already have finished (fast local run); only bind if it is still ours and unbound.
        if (cur && cur.generationId === null) update({ ...cur, generationId: r.value.generationId, conversationId: r.value.conversationId })
        return null
      } catch {
        update(null)
        return { code: 'unknown', message: '' }
      }
    },
    [api, update]
  )

  const cancel = useCallback(() => {
    const id = liveRef.current?.generationId
    if (api && id) void api.cancel(id)
  }, [api])

  // Leaving the app window: stop listening; the main process finishes and saves the turn on its own.
  return <AiContext.Provider value={{ api, live, version, started, ask, cancel }}>{children}</AiContext.Provider>
}

/** Provider settings as the interface may see them (never a key). */
export function useAiSettings() {
  const { api } = useAi()
  const [settings, setSettings] = useState<AiSettingsView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    if (!api) return
    const r = await api.getSettings()
    if (r.ok) setSettings(r.value)
  }, [api])
  useEffect(() => {
    void refresh()
  }, [refresh])
  const apply = useCallback(async (p: Promise<DataResult<AiSettingsView>>): Promise<AskFailure | null> => {
    const r = await p
    if (r.ok) {
      setSettings(r.value)
      setError(null)
      return null
    }
    setError(r.error.message)
    return failureOf(r)
  }, [])
  return { api, settings, error, refresh, apply }
}
