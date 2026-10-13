/**
 * Provider-independent language-model interface. Conversation, retrieval and
 * citation logic only ever talk to this; each adapter (Ollama, Anthropic,
 * OpenAI) keeps its own transport, authentication and stream parsing.
 *
 * The evidence is part of the final user message that the prompt builder
 * constructs, so an adapter just forwards messages and never sees the
 * knowledge base.
 */
import type { AiErrorCode, FinishReason, ProviderId, UsageInfo } from '@shared/ai'

export class ProviderError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface GenerateRequest {
  system: string
  messages: ChatTurn[]
  maxOutputTokens: number
  signal: AbortSignal
}

/** Normalised stream events; every adapter converts its own wire format into these. */
export type StreamEvent = { type: 'delta'; text: string } | { type: 'done'; finish: FinishReason; usage: UsageInfo }

export interface ProviderCapabilities {
  /** Data stays on this machine (loopback Ollama). */
  local: boolean
  streaming: boolean
  /** Reports token usage. */
  usage: boolean
  /** Prompt budget for evidence + history, in characters (a conservative proxy for the unknown context window). */
  contextChars: number
}

export interface ConnectionProbe {
  /** Models the provider reported (may be truncated). */
  models: string[]
  /** Null when the configured model could not be checked. */
  modelAvailable: boolean | null
}

export interface LanguageModelProvider {
  readonly id: ProviderId
  readonly model: string
  readonly capabilities: ProviderCapabilities
  /** Synchronous configuration check; null when valid. */
  validate(): ProviderError | null
  /** Contacts the provider (authenticated, no generation) and checks the configured model. Throws ProviderError. */
  probe(signal: AbortSignal): Promise<ConnectionProbe>
  /** Streams one answer. Throws ProviderError; cancellation surfaces as an AbortError-free early end only via `signal`. */
  stream(req: GenerateRequest): AsyncGenerator<StreamEvent, void, void>
}

const TOKENISH = /\b(?:sk-[A-Za-z0-9_-]{6,}|[A-Za-z0-9_-]{32,})\b/g

/** Removes anything key-shaped from provider text before it can reach a log or the UI. */
export function redact(text: string, secrets: readonly string[] = []): string {
  let out = text
  for (const s of secrets) if (s.length >= 6) out = out.split(s).join('[redacted]')
  return out.replace(TOKENISH, '[redacted]')
}

export function safeDetail(text: unknown, secrets: readonly string[] = [], max = 200): string {
  if (typeof text !== 'string') return ''
  const t = redact(text.replace(/\s+/g, ' ').trim(), secrets)
  return t.length > max ? `${t.slice(0, max)}…` : t
}

/** Maps an HTTP status to the error class the UI explains. */
export function errorForStatus(status: number, detail = ''): ProviderError {
  const d = detail ? ` (${detail})` : ''
  if (status === 401 || status === 403) return new ProviderError('auth', 'The provider rejected the credentials.', status)
  if (status === 404) return new ProviderError('model_not_found', `The model or endpoint was not found${d}.`, status)
  if (status === 408) return new ProviderError('timeout', 'The provider timed out.', status)
  if (status === 429) return new ProviderError('rate_limit', 'The provider is rate limiting requests or the quota is exhausted.', status)
  if (status >= 500) return new ProviderError('unavailable', `The provider is temporarily unavailable${d}.`, status)
  if (status === 400 || status === 413 || status === 422) return new ProviderError('invalid_request', `The provider rejected the request${d}.`, status)
  return new ProviderError('internal', `The provider returned an unexpected status ${status}${d}.`, status)
}

/** Idle watchdog: aborts `controller` when no activity is reported for `ms`. */
export function idleWatchdog(controller: AbortController, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let fired = false
  const arm = (limit = ms) => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      fired = true
      controller.abort()
    }, limit)
  }
  return { arm, stop: () => clearTimeout(timer), get fired() { return fired } }
}

/** Combines an external cancel signal with an internal one. */
export function anySignal(...signals: AbortSignal[]): AbortSignal {
  return AbortSignal.any(signals)
}
