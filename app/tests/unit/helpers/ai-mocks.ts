/** Deterministic wire-format fixtures for the provider adapters. No network, no real keys. */
import type { LanguageModelProvider, StreamEvent } from '../../../src/main/ai/provider'

export const enc = new TextEncoder()

export function sse(frames: { event?: string; data: unknown }[], init: ResponseInit = {}): Response {
  const body = frames.map((f) => `${f.event ? `event: ${f.event}\n` : ''}data: ${typeof f.data === 'string' ? f.data : JSON.stringify(f.data)}\n\n`).join('')
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' }, ...init })
}

export function ndjson(lines: unknown[], init: ResponseInit = {}): Response {
  return new Response(lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n', { status: 200, headers: { 'content-type': 'application/x-ndjson' }, ...init })
}

export const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

/** A stream that emits `first` and then hangs until the request is aborted (then errors like fetch does). */
export function hangingStream(first: string, signal: AbortSignal | null | undefined, contentType = 'text/event-stream'): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode(first))
      signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')))
    }
  })
  return new Response(body, { status: 200, headers: { 'content-type': contentType } })
}

export function anthropicStream(texts: string[], opts: { stop?: string; inputTokens?: number; outputTokens?: number } = {}) {
  return sse([
    { event: 'message_start', data: { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', content: [], model: 'test-model', stop_reason: null, stop_sequence: null, usage: { input_tokens: opts.inputTokens ?? 25, output_tokens: 1 } } } },
    { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
    ...texts.map((t) => ({ event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } } })),
    { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
    { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: opts.stop ?? 'end_turn', stop_sequence: null }, usage: { output_tokens: opts.outputTokens ?? 15 } } },
    { event: 'message_stop', data: { type: 'message_stop' } }
  ])
}

export function openaiStream(texts: string[], opts: { incomplete?: string; failed?: string } = {}) {
  const response = (status: string, extra: object = {}) => ({ id: 'resp_1', object: 'response', status, model: 'test-model', output: [], usage: { input_tokens: 31, output_tokens: 12, total_tokens: 43 }, ...extra })
  const frames: { event: string; data: unknown }[] = [
    { event: 'response.created', data: { type: 'response.created', sequence_number: 0, response: response('in_progress') } },
    ...texts.map((t, i) => ({ event: 'response.output_text.delta', data: { type: 'response.output_text.delta', sequence_number: i + 1, item_id: 'msg_1', output_index: 0, content_index: 0, delta: t, logprobs: [] } }))
  ]
  if (opts.failed) frames.push({ event: 'response.failed', data: { type: 'response.failed', sequence_number: 99, response: response('failed', { error: { code: 'server_error', message: opts.failed } }) } })
  else if (opts.incomplete) frames.push({ event: 'response.incomplete', data: { type: 'response.incomplete', sequence_number: 99, response: response('incomplete', { incomplete_details: { reason: opts.incomplete } }) } })
  else frames.push({ event: 'response.completed', data: { type: 'response.completed', sequence_number: 99, response: response('completed') } })
  return sse(frames)
}

/** Scripted provider for pipeline tests: records what it was sent and replays events. */
export class FakeProvider implements LanguageModelProvider {
  readonly id: 'ollama' | 'anthropic' | 'openai'
  readonly model = 'fake-model'
  readonly capabilities: LanguageModelProvider['capabilities']
  calls: { system: string; messages: { role: string; content: string }[] }[] = []
  constructor(
    private script: (req: { signal: AbortSignal }) => AsyncGenerator<StreamEvent, void, void> | Generator<StreamEvent, void, void>,
    id: 'ollama' | 'anthropic' | 'openai' = 'ollama'
  ) {
    this.id = id
    this.capabilities = { local: id === 'ollama', streaming: true, usage: true, contextChars: 14000 }
  }
  validate() {
    return null
  }
  async probe() {
    return { models: ['fake-model'], modelAvailable: true }
  }
  async *stream(req: { system: string; messages: { role: string; content: string }[]; signal: AbortSignal }) {
    this.calls.push({ system: req.system, messages: req.messages.map((m) => ({ ...m })) })
    yield* this.script(req)
  }
}

export const reply = (text: string, finish: 'stop' | 'length' | 'refusal' | 'other' = 'stop') =>
  function* (): Generator<StreamEvent> {
    yield { type: 'delta', text }
    yield { type: 'done', finish, usage: { inputTokens: 10, outputTokens: 5 } }
  }
