/**
 * Grounded answer generation.
 *
 *   question → validate → Phase 5 retrieval (hybrid) → bounded, deduplicated
 *   evidence S1…Sn → prompt → provider stream → citation validation against
 *   the evidence that was actually supplied → persistence.
 *
 * Privacy: nothing leaves the process before the user has submitted a
 * question with a configured (and, for cloud, acknowledged) provider. There
 * is no fallback: an error ends the turn, it never reroutes to another
 * provider. No query, prompt, passage or answer text is ever logged.
 */
import { randomUUID } from 'node:crypto'
import {
  isCloudProvider,
  type AiErrorCode,
  type AiEvent,
  type AiSettings,
  type AskStarted,
  type ChatMessage,
  type ConnectionTestResult,
  type FinishReason,
  type ProviderId,
  type UsageInfo
} from '@shared/ai'
import { askSchema, conversationIdSchema, generationIdSchema, providerSchema } from '@shared/ai-contracts'
import { checkAnswer, citedRefs } from '@shared/citations'
import type { RetrievalResponse } from '@shared/retrieval'
import type { ConversationsRepo } from '../db/repositories/conversations'
import type { SemanticRepo } from '../db/repositories/semantic'
import { DataError } from '../services/workspace-service'
import { AnthropicProvider } from './anthropic'
import type { CredentialStore } from './credentials'
import { selectEvidence } from './evidence'
import { OllamaProvider } from './ollama'
import { OpenAiProvider } from './openai'
import { buildPrompt, SYSTEM_PROMPT } from './prompt'
import { contentQuery } from './query'
import { ProviderError, type LanguageModelProvider } from './provider'
import type { AiSettingsService } from './settings'

export interface AnswerDeps {
  conversations: ConversationsRepo
  semanticRepo: SemanticRepo
  retrieve: (query: unknown) => Promise<RetrievalResponse>
  settings: AiSettingsService
  credentials: CredentialStore
  makeProvider?: (settings: AiSettings, provider: ProviderId, apiKey: string | null) => LanguageModelProvider
  now?: () => Date
  /** Hard cap for one generation, retrieval included. */
  totalTimeoutMs?: number
}

export const NO_EVIDENCE_TEXT = 'No relevant evidence was found in your knowledge base for this question.'

export function defaultProviderFactory(s: AiSettings, provider: ProviderId, apiKey: string | null): LanguageModelProvider {
  if (provider === 'ollama') return new OllamaProvider({ baseUrl: s.ollama.baseUrl, model: s.ollama.model })
  if (provider === 'anthropic') return new AnthropicProvider({ apiKey: apiKey ?? '', model: s.anthropic.model })
  return new OpenAiProvider({ apiKey: apiKey ?? '', model: s.openai.model })
}

const preflight = (code: AiErrorCode, message: string) => new DataError('validation', message, { ai: code })

function limitsFor(p: LanguageModelProvider) {
  return p.capabilities.local ? { maxSources: 6, maxOutputTokens: 1024 } : { maxSources: 10, maxOutputTokens: 2048 }
}

export function createAnswerService(deps: AnswerDeps) {
  const now = deps.now ?? (() => new Date())
  const make = deps.makeProvider ?? defaultProviderFactory
  const active = new Map<string, { controller: AbortController; conversationId: string }>()

  /** Builds the configured provider, or throws the reason it cannot be used. */
  async function resolve(provider: ProviderId, forGeneration: boolean): Promise<LanguageModelProvider> {
    const settings = deps.settings.load()
    let key: string | null = null
    if (isCloudProvider(provider)) {
      if (forGeneration && !settings.cloudAcknowledged[provider]) {
        throw preflight('consent_required', 'Confirm in Settings that your questions and retrieved passages may be sent to this provider.')
      }
      key = await deps.credentials.get(provider)
      if (!key) {
        const info = deps.credentials.info(provider)
        throw preflight('not_configured', info.state === 'unreadable' ? 'The stored key cannot be read. Save it again in Settings.' : 'Add an API key for this provider in Settings.')
      }
    }
    const p = make(settings, provider, key)
    const bad = p.validate()
    if (bad) throw preflight(bad.code, bad.message)
    return p
  }

  async function testConnection(input: unknown): Promise<ConnectionTestResult> {
    const parsed = providerSchema.safeParse(input)
    if (!parsed.success) throw new DataError('validation', 'Invalid provider')
    const id = parsed.data
    const settings = deps.settings.load()
    const model = settings[id].model
    const started = Date.now()
    const out = (patch: Partial<ConnectionTestResult>): ConnectionTestResult => ({
      provider: id,
      ok: false,
      code: null,
      model,
      modelAvailable: null,
      models: [],
      checkedAt: now().toISOString(),
      latencyMs: Date.now() - started,
      ...patch
    })
    try {
      const provider = await resolve(id, false)
      const probe = await provider.probe(AbortSignal.timeout(15_000))
      // A reachable provider with an unknown model is reported as a problem, not as a working setup.
      if (probe.modelAvailable === false) return out({ ok: false, code: 'model_not_found', models: probe.models, modelAvailable: false })
      return out({ ok: true, models: probe.models, modelAvailable: probe.modelAvailable })
    } catch (err) {
      if (err instanceof DataError) return out({ code: (err.fields?.['ai'] as AiErrorCode | undefined) ?? 'not_configured' })
      if (err instanceof ProviderError) return out({ code: err.code })
      return out({ code: (err as Error)?.name === 'TimeoutError' ? 'timeout' : 'internal' })
    }
  }

  async function ask(input: unknown, emit: (e: AiEvent) => void): Promise<AskStarted> {
    const parsed = askSchema.safeParse(input)
    if (!parsed.success) throw new DataError('validation', 'Invalid question')
    const { conversationId: existing, question } = parsed.data
    if (active.size > 0) throw preflight('busy', 'An answer is already being generated.')
    const settings = deps.settings.load()
    if (!settings.provider) throw preflight('not_configured', 'Choose an AI provider in Settings first.')
    const provider = await resolve(settings.provider, true)
    if (existing && !deps.conversations.exists(existing)) throw new DataError('not_found', 'Conversation not found')

    const stamp = now().toISOString()
    const conversationId = existing ?? deps.conversations.createConversation(question, stamp)
    const history = existing ? deps.conversations.history(existing) : []
    const userMessage = deps.conversations.addMessage(conversationId, { role: 'user', content: question }, stamp)
    const generationId = `gen-${randomUUID()}`
    const controller = new AbortController()
    active.set(generationId, { controller, conversationId })
    const send = (e: AiEvent) => {
      try {
        emit(e)
      } catch {
        /* window gone: the result is persisted anyway */
      }
    }
    send({ generationId, conversationId, type: 'started', userMessage })
    void run({ generationId, conversationId, question, history, provider, controller, send }).finally(() => active.delete(generationId))
    return { generationId, conversationId }
  }

  interface Run {
    generationId: string
    conversationId: string
    question: string
    history: { role: 'user' | 'assistant'; content: string }[]
    provider: LanguageModelProvider
    controller: AbortController
    send: (e: AiEvent) => void
  }

  async function run(r: Run): Promise<void> {
    const { generationId, conversationId, provider, controller, send } = r
    const began = Date.now()
    const base = { provider: provider.id, model: provider.model }
    const cap = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, deps.totalTimeoutMs ?? 300_000)
    let timedOut = false
    let text = ''
    let semanticAvailable: boolean | null = null

    const finishWith = (status: 'complete' | 'cancelled' | 'error', extra: Partial<Parameters<ConversationsRepo['addMessage']>[1]>): ChatMessage =>
      deps.conversations.addMessage(
        conversationId,
        { role: 'assistant', content: text, status, ...base, durationMs: Date.now() - began, semanticAvailable, ...extra },
        now().toISOString()
      )
    const fail = (code: AiErrorCode) => {
      const message = finishWith('error', { errorCode: code })
      console.error('[ai] generation failed:', code)
      send({ generationId, conversationId, type: 'error', code, message })
    }
    const cancelled = () => {
      if (timedOut) return fail('timeout')
      const message = finishWith('cancelled', {})
      send({ generationId, conversationId, type: 'cancelled', message })
    }

    try {
      // 1. Retrieval through the Phase 5 service (hybrid: keyword + semantic when the model is installed).
      let retrieval: RetrievalResponse
      try {
        retrieval = await deps.retrieve({ text: r.question.slice(0, 500), mode: 'hybrid', limit: 12 })
        const reduced = retrieval.results.length === 0 ? contentQuery(r.question) : null
        // Keyword search needs every term to match: retry once without question/filler words.
        if (reduced) {
          const second = await deps.retrieve({ text: reduced, mode: 'hybrid', limit: 12 })
          if (second.results.length) retrieval = second
        }
      } catch {
        return fail('retrieval_failed')
      }
      if (controller.signal.aborted) return cancelled()
      semanticAvailable = retrieval.semantic === 'ok'

      // 2. Evidence within the provider's budget.
      const limits = limitsFor(provider)
      const overhead = SYSTEM_PROMPT.length + r.question.length + 3500
      const chars = Math.max(2500, provider.capabilities.contextChars - overhead)
      const sources = selectEvidence(retrieval.results, deps.semanticRepo, { chars, maxSources: limits.maxSources })
      send({ generationId, conversationId, type: 'retrieved', sources, semanticAvailable, indexIncomplete: retrieval.indexIncomplete })

      // 3. No evidence: answer honestly without calling any model (nothing is sent anywhere).
      if (sources.length === 0) {
        const message = deps.conversations.addMessage(
          conversationId,
          { role: 'assistant', content: NO_EVIDENCE_TEXT, status: 'complete', noEvidence: true, semanticAvailable, durationMs: Date.now() - began },
          now().toISOString()
        )
        return send({ generationId, conversationId, type: 'done', message })
      }

      // 4. Generation.
      const prompt = buildPrompt(r.question, sources, r.history)
      let finish: FinishReason = 'stop'
      let usage: UsageInfo = { inputTokens: null, outputTokens: null }
      let completed = false
      for await (const ev of provider.stream({ system: prompt.system, messages: prompt.messages, maxOutputTokens: limits.maxOutputTokens, signal: controller.signal })) {
        if (ev.type === 'delta') {
          text += ev.text
          send({ generationId, conversationId, type: 'delta', text: ev.text })
        } else {
          finish = ev.finish
          usage = ev.usage
          completed = true
        }
      }
      if (controller.signal.aborted) return cancelled()
      if (!completed) return fail('bad_response')
      if (!text.trim() && finish !== 'refusal') return fail('empty_response')

      // 5. Citation validation against the sources supplied for THIS response.
      const valid = new Set(sources.map((s) => s.ref))
      const check = checkAnswer(text, valid)
      const cited = new Set(citedRefs(text, valid))
      const message = finishWith('complete', {
        finish,
        usage,
        check,
        sources: sources.filter((s) => cited.has(s.ref)),
        errorCode: finish === 'refusal' ? 'refused' : null
      })
      send({ generationId, conversationId, type: 'done', message })
    } catch (err) {
      if (controller.signal.aborted) return cancelled()
      fail(err instanceof ProviderError ? err.code : 'internal')
    } finally {
      clearTimeout(cap)
    }
  }

  return {
    ask,
    testConnection,
    cancel(input: unknown): void {
      const id = generationIdSchema.safeParse(input)
      if (!id.success) throw new DataError('validation', 'Invalid id')
      active.get(id.data)?.controller.abort()
    },
    /** Quit: abort anything in flight (partial text is saved as cancelled). */
    async cancelAll(): Promise<void> {
      for (const a of active.values()) a.controller.abort()
      for (let i = 0; i < 20 && active.size > 0; i++) await new Promise((r) => setTimeout(r, 50))
    },
    get activeCount() {
      return active.size
    },
    listConversations: () => deps.conversations.list(),
    getConversation(input: unknown) {
      const id = conversationIdSchema.safeParse(input)
      if (!id.success) throw new DataError('validation', 'Invalid id')
      const c = deps.conversations.get(id.data)
      if (!c) throw new DataError('not_found', 'Conversation not found')
      return c
    },
    deleteConversation(input: unknown): null {
      const id = conversationIdSchema.safeParse(input)
      if (!id.success) throw new DataError('validation', 'Invalid id')
      if ([...active.values()].some((a) => a.conversationId === id.data)) throw preflight('busy', 'Cancel the running answer first.')
      if (!deps.conversations.delete(id.data)) throw new DataError('not_found', 'Conversation not found')
      return null
    }
  }
}
export type AnswerService = ReturnType<typeof createAnswerService>
