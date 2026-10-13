/**
 * OpenAI adapter: official `openai` SDK, Responses API (`responses.create`
 * with `stream: true`). Stream events used here: `response.output_text.delta`
 * (text), `response.refusal.delta` (model refusal), `response.completed`
 * (usage), `response.incomplete` (e.g. max_output_tokens), `response.failed`
 * and the generic `error` event. `store: false` keeps the request out of the
 * stored-responses feature. The model id comes from Settings and is never
 * defaulted; no sampling parameters are sent because some models reject them.
 */
import OpenAI from 'openai'
import type { FinishReason, UsageInfo } from '@shared/ai'
import { ProviderError, safeDetail, type ConnectionProbe, type GenerateRequest, type LanguageModelProvider, type StreamEvent } from './provider'
import { mapSdkError } from './sdk-errors'

/** Pinned so an OPENAI_BASE_URL environment variable can never redirect the API key to another host. */
export const OPENAI_BASE_URL = 'https://api.openai.com/v1'

export interface OpenAiOptions {
  apiKey: string
  model: string
  fetch?: typeof fetch
  timeoutMs?: number
  maxRetries?: number
}

export class OpenAiProvider implements LanguageModelProvider {
  readonly id = 'openai' as const
  readonly model: string
  readonly capabilities = { local: false, streaming: true, usage: true, contextChars: 60000 }
  private readonly client: OpenAI

  constructor(private readonly o: OpenAiOptions) {
    this.model = o.model.trim()
    this.client = new OpenAI({
      // The SDK refuses an empty key at construction; validate() blocks any request without a real one.
      apiKey: o.apiKey || 'unset',
      baseURL: OPENAI_BASE_URL,
      timeout: o.timeoutMs ?? 120_000,
      maxRetries: o.maxRetries ?? 2,
      ...(o.fetch ? { fetch: o.fetch } : {})
    })
  }

  validate(): ProviderError | null {
    if (!this.o.apiKey) return new ProviderError('not_configured', 'Add an OpenAI API key in Settings.')
    if (!this.model) return new ProviderError('not_configured', 'Enter a model identifier for OpenAI in Settings.')
    return null
  }

  private fail(err: unknown, signal?: AbortSignal): ProviderError | null {
    return mapSdkError(err, [this.o.apiKey], signal?.aborted ?? false)
  }

  async probe(signal: AbortSignal): Promise<ConnectionProbe> {
    if (!this.o.apiKey) throw new ProviderError('not_configured', 'Add an OpenAI API key in Settings.')
    try {
      if (this.model) {
        try {
          await this.client.models.retrieve(this.model, { signal, maxRetries: 0 })
          return { models: [this.model], modelAvailable: true }
        } catch (err) {
          if ((err as { status?: number }).status !== 404) throw err
        }
      }
      const models: string[] = []
      for await (const m of this.client.models.list({ signal, maxRetries: 0 })) {
        models.push(m.id)
        if (models.length >= 200) break
      }
      return { models, modelAvailable: this.model ? false : null }
    } catch (err) {
      throw this.fail(err, signal) ?? new ProviderError('internal', 'The connection test was cancelled.')
    }
  }

  async *stream(req: GenerateRequest): AsyncGenerator<StreamEvent, void, void> {
    const bad = this.validate()
    if (bad) throw bad
    let usage: UsageInfo = { inputTokens: null, outputTokens: null }
    let finish: FinishReason | null = null
    let sawText = false
    let refused = false
    try {
      const events = await this.client.responses.create(
        {
          model: this.model,
          instructions: req.system,
          input: req.messages.map((m) => ({ role: m.role, content: m.content })),
          max_output_tokens: req.maxOutputTokens,
          store: false,
          stream: true
        },
        { signal: req.signal }
      )
      for await (const ev of events) {
        switch (ev.type) {
          case 'response.output_text.delta':
            if (ev.delta) {
              sawText = true
              yield { type: 'delta', text: ev.delta }
            }
            break
          case 'response.refusal.delta':
            refused = true
            break
          case 'response.completed':
          case 'response.incomplete': {
            const u = ev.response.usage
            usage = { inputTokens: u?.input_tokens ?? null, outputTokens: u?.output_tokens ?? null }
            if (ev.type === 'response.incomplete') {
              const reason = ev.response.incomplete_details?.reason
              finish = reason === 'max_output_tokens' ? 'length' : reason === 'content_filter' ? 'refusal' : 'other'
            } else finish = refused ? 'refusal' : 'stop'
            break
          }
          case 'response.failed':
            throw new ProviderError('unavailable', `The provider could not complete the response${ev.response.error?.message ? ` (${safeDetail(ev.response.error.message, [this.o.apiKey])})` : ''}.`)
          case 'error':
            throw new ProviderError('unavailable', `The provider reported an error${ev.message ? ` (${safeDetail(ev.message, [this.o.apiKey])})` : ''}.`)
          default:
            break
        }
      }
    } catch (err) {
      if (req.signal.aborted) return
      throw this.fail(err, req.signal) ?? new ProviderError('internal', 'The request failed.')
    }
    if (req.signal.aborted) return
    if (finish === null) throw new ProviderError('bad_response', 'The response stream ended before it completed.')
    if (!sawText && finish !== 'refusal') throw new ProviderError('empty_response', 'The model returned no text.')
    yield { type: 'done', finish, usage }
  }
}
