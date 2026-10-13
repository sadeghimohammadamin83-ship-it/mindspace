/**
 * Anthropic adapter: official `@anthropic-ai/sdk`, Messages API, server-sent
 * events. The raw stream events handled here are message_start (input
 * tokens), content_block_delta/text_delta (text), message_delta (stop reason
 * and output tokens). Optional sampling parameters are deliberately not sent
 * because not every model accepts them; the model id comes from Settings and
 * is never defaulted.
 */
import Anthropic from '@anthropic-ai/sdk'
import type { FinishReason, UsageInfo } from '@shared/ai'
import { ProviderError, type ConnectionProbe, type GenerateRequest, type LanguageModelProvider, type StreamEvent } from './provider'
import { mapSdkError } from './sdk-errors'

/** Pinned so an ANTHROPIC_BASE_URL environment variable can never redirect the API key to another host. */
export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com'

export interface AnthropicOptions {
  apiKey: string
  model: string
  fetch?: typeof fetch
  timeoutMs?: number
  maxRetries?: number
}

function finishFor(reason: string | null | undefined): FinishReason {
  if (reason === 'max_tokens' || reason === 'model_context_window_exceeded') return 'length'
  if (reason === 'refusal') return 'refusal'
  if (reason === 'end_turn' || reason === 'stop_sequence' || !reason) return 'stop'
  return 'other'
}

export class AnthropicProvider implements LanguageModelProvider {
  readonly id = 'anthropic' as const
  readonly model: string
  readonly capabilities = { local: false, streaming: true, usage: true, contextChars: 60000 }
  private readonly client: Anthropic

  constructor(private readonly o: AnthropicOptions) {
    this.model = o.model.trim()
    this.client = new Anthropic({
      apiKey: o.apiKey,
      baseURL: ANTHROPIC_BASE_URL,
      timeout: o.timeoutMs ?? 120_000,
      maxRetries: o.maxRetries ?? 2,
      ...(o.fetch ? { fetch: o.fetch } : {})
    })
  }

  validate(): ProviderError | null {
    if (!this.o.apiKey) return new ProviderError('not_configured', 'Add an Anthropic API key in Settings.')
    if (!this.model) return new ProviderError('not_configured', 'Enter a model identifier for Anthropic in Settings.')
    return null
  }

  private fail(err: unknown, signal?: AbortSignal): ProviderError | null {
    return mapSdkError(err, [this.o.apiKey], signal?.aborted ?? false)
  }

  async probe(signal: AbortSignal): Promise<ConnectionProbe> {
    if (!this.o.apiKey) throw new ProviderError('not_configured', 'Add an Anthropic API key in Settings.')
    try {
      if (this.model) {
        try {
          await this.client.models.retrieve(this.model, undefined, { signal, maxRetries: 0 })
          return { models: [this.model], modelAvailable: true }
        } catch (err) {
          if ((err as { status?: number }).status !== 404) throw err
          // Key works but this account cannot use that model: fall through to list what it can use.
        }
      }
      const page = await this.client.models.list({ limit: 100 }, { signal, maxRetries: 0 })
      const models = page.data.map((m) => m.id).slice(0, 200)
      return { models, modelAvailable: this.model ? false : null }
    } catch (err) {
      throw this.fail(err, signal) ?? new ProviderError('internal', 'The connection test was cancelled.')
    }
  }

  async *stream(req: GenerateRequest): AsyncGenerator<StreamEvent, void, void> {
    const bad = this.validate()
    if (bad) throw bad
    let usage: UsageInfo = { inputTokens: null, outputTokens: null }
    let stop: string | null = null
    let sawText = false
    try {
      const events = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: req.maxOutputTokens,
          system: req.system,
          messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
          stream: true
        },
        { signal: req.signal }
      )
      for await (const ev of events) {
        if (ev.type === 'message_start') usage = { ...usage, inputTokens: ev.message.usage?.input_tokens ?? null }
        else if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
          if (ev.delta.text) {
            sawText = true
            yield { type: 'delta', text: ev.delta.text }
          }
        } else if (ev.type === 'message_delta') {
          stop = ev.delta.stop_reason ?? stop
          usage = { ...usage, outputTokens: ev.usage?.output_tokens ?? usage.outputTokens }
        }
      }
    } catch (err) {
      if (req.signal.aborted) return
      throw this.fail(err, req.signal) ?? new ProviderError('internal', 'The request failed.')
    }
    if (req.signal.aborted) return
    if (!sawText && stop !== 'refusal') throw new ProviderError('empty_response', 'The model returned no text.')
    yield { type: 'done', finish: finishFor(stop), usage }
  }
}
