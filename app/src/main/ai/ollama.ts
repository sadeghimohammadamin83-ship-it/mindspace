/**
 * Ollama adapter (local). Talks to the documented REST API:
 *   GET  /api/tags   installed models (also the availability probe)
 *   POST /api/chat   streaming chat; the response is NDJSON, one JSON object per line
 *
 * Privacy: only loopback endpoints are accepted and redirects are refused, so
 * a local setting can never silently turn into a request to another machine.
 * There is no fallback to any other provider.
 */
import type { UsageInfo } from '@shared/ai'
import { OLLAMA_DEFAULT_URL } from '@shared/ai'
import {
  errorForStatus,
  idleWatchdog,
  ProviderError,
  safeDetail,
  type ConnectionProbe,
  type GenerateRequest,
  type LanguageModelProvider,
  type StreamEvent
} from './provider'

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

/** Returns the normalised origin, or throws ProviderError('not_configured') for anything that is not plain http loopback. */
export function parseOllamaUrl(raw: string): string {
  const text = raw.trim() || OLLAMA_DEFAULT_URL
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new ProviderError('not_configured', 'The Ollama address is not a valid URL.')
  }
  if (url.protocol !== 'http:') throw new ProviderError('not_configured', 'The Ollama address must use http:// on this computer.')
  if (!LOOPBACK.has(url.hostname)) {
    throw new ProviderError('not_configured', 'Only a local Ollama (127.0.0.1, localhost or ::1) is supported, so your data stays on this computer.')
  }
  if (url.username || url.password || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
    throw new ProviderError('not_configured', 'Enter only the address and port, for example http://127.0.0.1:11434.')
  }
  return url.origin
}

export interface OllamaOptions {
  baseUrl: string
  model: string
  fetch?: typeof fetch
  numCtx?: number
  temperature?: number
  /** Time allowed until the first streamed byte (a cold model load can be slow). */
  firstChunkMs?: number
  /** Silence allowed between chunks once streaming started. */
  idleMs?: number
  probeMs?: number
}

const sameModel = (configured: string, installed: string) => installed === configured || installed === `${configured}:latest`

function networkError(origin: string): ProviderError {
  return new ProviderError('unavailable', `Cannot reach Ollama at ${origin}. Make sure Ollama is installed and running.`)
}

export class OllamaProvider implements LanguageModelProvider {
  readonly id = 'ollama' as const
  readonly model: string
  readonly capabilities = { local: true, streaming: true, usage: true, contextChars: 14000 }
  private readonly doFetch: typeof fetch
  private origin: string | null = null
  private readonly configError: ProviderError | null = null

  constructor(private readonly o: OllamaOptions) {
    this.model = o.model.trim()
    this.doFetch = o.fetch ?? fetch
    try {
      this.origin = parseOllamaUrl(o.baseUrl)
    } catch (e) {
      this.configError = e as ProviderError
    }
  }

  validate(): ProviderError | null {
    if (this.configError) return this.configError
    if (!this.model) return new ProviderError('not_configured', 'Choose an installed Ollama model in Settings.')
    return null
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    try {
      // `redirect: 'error'` keeps a loopback request on loopback.
      return await this.doFetch(`${this.origin}${path}`, { ...init, redirect: 'error' })
    } catch (err) {
      if (init.signal?.aborted) throw err
      throw networkError(this.origin ?? '')
    }
  }

  async probe(signal: AbortSignal): Promise<ConnectionProbe> {
    if (this.configError) throw this.configError
    const wd = new AbortController()
    const timer = setTimeout(() => wd.abort(), this.o.probeMs ?? 5000)
    try {
      const res = await this.request('/api/tags', { method: 'GET', signal: AbortSignal.any([signal, wd.signal]) })
      if (!res.ok) throw errorForStatus(res.status)
      const body = (await res.json().catch(() => null)) as { models?: { name?: unknown }[] } | null
      if (!body || !Array.isArray(body.models)) throw new ProviderError('bad_response', 'Ollama returned an unexpected response.')
      const models = body.models.map((m) => m.name).filter((n): n is string => typeof n === 'string').slice(0, 200)
      return { models, modelAvailable: this.model ? models.some((m) => sameModel(this.model, m)) : null }
    } catch (err) {
      if (err instanceof ProviderError) throw err
      if (wd.signal.aborted && !signal.aborted) throw new ProviderError('timeout', 'Ollama did not answer in time.')
      throw err
    } finally {
      clearTimeout(timer)
    }
  }

  async *stream(req: GenerateRequest): AsyncGenerator<StreamEvent, void, void> {
    const bad = this.validate()
    if (bad) throw bad
    const internal = new AbortController()
    const wd = idleWatchdog(internal, this.o.idleMs ?? 60_000)
    wd.arm(this.o.firstChunkMs ?? 180_000)
    const signal = AbortSignal.any([req.signal, internal.signal])
    const body = {
      model: this.model,
      stream: true,
      messages: [{ role: 'system', content: req.system }, ...req.messages],
      options: { num_ctx: this.o.numCtx ?? 8192, temperature: this.o.temperature ?? 0.2, num_predict: req.maxOutputTokens }
    }
    try {
      const res = await this.request('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal
      })
      if (!res.ok) {
        const detail = safeDetail(((await res.json().catch(() => null)) as { error?: unknown } | null)?.error)
        if (res.status === 404) throw new ProviderError('model_not_found', `Ollama has no model named "${this.model}". Install it (ollama pull ${this.model}) or pick another.`, 404)
        throw errorForStatus(res.status, detail)
      }
      if (!res.body) throw new ProviderError('bad_response', 'Ollama returned an empty response.')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finished = false
      const model = this.model
      const handle = function* (line: string): Generator<StreamEvent> {
        if (!line.trim()) return
        let msg: { message?: { content?: unknown }; done?: boolean; done_reason?: string; error?: unknown; prompt_eval_count?: unknown; eval_count?: unknown }
        try {
          msg = JSON.parse(line)
        } catch {
          throw new ProviderError('bad_response', 'Ollama sent a malformed stream line.')
        }
        if (typeof msg.error === 'string') {
          const d = safeDetail(msg.error)
          if (/not found/i.test(d)) throw new ProviderError('model_not_found', `Ollama has no model named "${model}". Install it or pick another.`)
          throw new ProviderError('unavailable', `Ollama reported an error: ${d}`)
        }
        const text = msg.message?.content
        if (typeof text === 'string' && text) yield { type: 'delta', text }
        if (msg.done === true) {
          finished = true
          const usage: UsageInfo = {
            inputTokens: typeof msg.prompt_eval_count === 'number' ? msg.prompt_eval_count : null,
            outputTokens: typeof msg.eval_count === 'number' ? msg.eval_count : null
          }
          yield { type: 'done', finish: msg.done_reason === 'length' ? 'length' : msg.done_reason && msg.done_reason !== 'stop' ? 'other' : 'stop', usage }
        }
      }
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          wd.arm()
          buffer += decoder.decode(value, { stream: true })
          let nl: number
          while ((nl = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, nl)
            buffer = buffer.slice(nl + 1)
            yield* handle(line)
          }
        }
        buffer += decoder.decode()
        yield* handle(buffer)
      } finally {
        reader.cancel().catch(() => undefined)
      }
      if (!finished && !signal.aborted) throw new ProviderError('bad_response', 'The Ollama stream ended unexpectedly.')
    } catch (err) {
      if (err instanceof ProviderError) throw err
      if (req.signal.aborted) return
      if (wd.fired) throw new ProviderError('timeout', 'Ollama stopped responding.')
      throw new ProviderError('unavailable', `The connection to Ollama was interrupted.`)
    } finally {
      wd.stop()
    }
  }
}
