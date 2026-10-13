// @vitest-environment node
/**
 * Adapter tests with MOCKED provider wire formats (no network, no real key).
 * They verify our request building and stream parsing against the documented
 * formats; they do not prove an account's credentials or models work.
 */
import { describe, expect, it, vi } from 'vitest'
import { AnthropicProvider } from '../../src/main/ai/anthropic'
import { OllamaProvider, parseOllamaUrl } from '../../src/main/ai/ollama'
import { OpenAiProvider } from '../../src/main/ai/openai'
import { ProviderError, redact, type GenerateRequest, type StreamEvent } from '../../src/main/ai/provider'
import { anthropicStream, hangingStream, jsonResponse, ndjson, openaiStream } from './helpers/ai-mocks'

const KEY = 'sk-test-0123456789abcdefghijklmnop'
const req = (over: Partial<GenerateRequest> = {}): GenerateRequest => ({
  system: 'sys',
  messages: [{ role: 'user', content: 'hi' }],
  maxOutputTokens: 256,
  signal: new AbortController().signal,
  ...over
})

async function collect(gen: AsyncGenerator<StreamEvent>) {
  const out: StreamEvent[] = []
  for await (const e of gen) out.push(e)
  return out
}
const text = (ev: StreamEvent[]) => ev.flatMap((e) => (e.type === 'delta' ? [e.text] : [])).join('')
const errorOf = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    return e as ProviderError
  }
  throw new Error('expected an error')
}

describe('Ollama adapter', () => {
  const mk = (fetchImpl: typeof fetch, over: Record<string, unknown> = {}) => new OllamaProvider({ baseUrl: 'http://127.0.0.1:11434', model: 'llama3', fetch: fetchImpl, ...over })

  it('accepts only loopback http addresses', () => {
    expect(parseOllamaUrl('')).toBe('http://127.0.0.1:11434')
    expect(parseOllamaUrl('http://localhost:11500')).toBe('http://localhost:11500')
    expect(parseOllamaUrl('http://[::1]:11434/')).toBe('http://[::1]:11434')
    for (const bad of ['http://192.168.1.5:11434', 'http://example.com', 'https://127.0.0.1:11434', 'http://127.0.0.1.evil.com', 'http://user:pw@127.0.0.1', 'http://127.0.0.1:11434/api', 'not a url', 'ftp://127.0.0.1']) {
      expect(() => parseOllamaUrl(bad), bad).toThrow(ProviderError)
    }
    const p = new OllamaProvider({ baseUrl: 'http://10.0.0.2:11434', model: 'm', fetch: vi.fn() as never })
    expect(p.validate()?.code).toBe('not_configured')
  })

  it('validates configuration (model required)', () => {
    expect(mk(vi.fn() as never, { model: ' ' }).validate()?.code).toBe('not_configured')
    expect(mk(vi.fn() as never).validate()).toBeNull()
  })

  it('streams NDJSON deltas, usage and finish reason; sends system + messages to /api/chat', async () => {
    const f = vi.fn(async (_u: unknown, _i?: RequestInit) =>
      ndjson([
        { message: { role: 'assistant', content: 'Hel' }, done: false },
        { message: { role: 'assistant', content: 'lo' }, done: false },
        { message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 12, eval_count: 7 }
      ])
    )
    const ev = await collect(mk(f as never).stream(req()))
    expect(text(ev)).toBe('Hello')
    expect(ev.at(-1)).toEqual({ type: 'done', finish: 'stop', usage: { inputTokens: 12, outputTokens: 7 } })
    const [url, init] = f.mock.calls[0]!
    expect(url).toBe('http://127.0.0.1:11434/api/chat')
    expect(init?.redirect).toBe('error')
    const body = JSON.parse(String(init?.body))
    expect(body.stream).toBe(true)
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' })
    expect(body.model).toBe('llama3')
  })

  it('reports truncation (done_reason length)', async () => {
    const f = async () => ndjson([{ message: { content: 'partial' }, done: false }, { done: true, done_reason: 'length' }])
    const ev = await collect(mk(f as never).stream(req()))
    expect(ev.at(-1)).toMatchObject({ type: 'done', finish: 'length' })
  })

  it('handles chunk boundaries inside a JSON line', async () => {
    const line1 = JSON.stringify({ message: { content: 'ab' }, done: false })
    const line2 = JSON.stringify({ done: true, done_reason: 'stop' })
    const whole = `${line1}\n${line2}\n`
    const f = async () =>
      new Response(
        new ReadableStream({
          start(c) {
            const e = new TextEncoder()
            c.enqueue(e.encode(whole.slice(0, 10)))
            c.enqueue(e.encode(whole.slice(10, 40)))
            c.enqueue(e.encode(whole.slice(40)))
            c.close()
          }
        })
      )
    expect(text(await collect(mk(f as never).stream(req())))).toBe('ab')
  })

  it('maps connection refusal to "unavailable" (not installed / not running) and never falls back', async () => {
    const f = vi.fn(async (..._a: unknown[]) => {
      throw new TypeError('fetch failed')
    })
    const e = await errorOf(collect(mk(f as never).stream(req())))
    expect(e.code).toBe('unavailable')
    expect(e.message).toMatch(/Ollama/)
    expect(f).toHaveBeenCalledTimes(1)
    expect(f.mock.calls.every((c) => String(c[0]).startsWith('http://127.0.0.1'))).toBe(true)
  })

  it('maps a missing model (404) and server errors', async () => {
    const e1 = await errorOf(collect(mk((async () => jsonResponse(404, { error: "model 'llama3' not found" })) as never).stream(req())))
    expect(e1.code).toBe('model_not_found')
    expect(e1.message).toContain('ollama pull llama3')
    const e2 = await errorOf(collect(mk((async () => jsonResponse(500, { error: 'boom' })) as never).stream(req())))
    expect(e2.code).toBe('unavailable')
  })

  it('rejects malformed and truncated streams', async () => {
    const bad = await errorOf(collect(mk((async () => ndjson(['{not json'])) as never).stream(req())))
    expect(bad.code).toBe('bad_response')
    const cut = await errorOf(collect(mk((async () => ndjson([{ message: { content: 'x' }, done: false }])) as never).stream(req())))
    expect(cut.code).toBe('bad_response')
    const inline = await errorOf(collect(mk((async () => ndjson([{ error: 'model "llama3" not found, try pulling it first' }])) as never).stream(req())))
    expect(inline.code).toBe('model_not_found')
  })

  it('stops on cancellation without raising an error', async () => {
    const ac = new AbortController()
    const f = async (_u: unknown, init?: RequestInit) => hangingStream(JSON.stringify({ message: { content: 'a' }, done: false }) + '\n', init?.signal, 'application/x-ndjson')
    const got: StreamEvent[] = []
    for await (const e of mk(f as never).stream(req({ signal: ac.signal }))) {
      got.push(e)
      ac.abort()
    }
    expect(text(got)).toBe('a')
  })

  it('times out when the model goes silent', async () => {
    const f = async (_u: unknown, init?: RequestInit) => hangingStream(JSON.stringify({ message: { content: 'a' }, done: false }) + '\n', init?.signal, 'application/x-ndjson')
    const e = await errorOf(collect(mk(f as never, { idleMs: 30, firstChunkMs: 200 }).stream(req())))
    expect(e.code).toBe('timeout')
  })

  it('probe lists installed models and checks the configured one', async () => {
    const f = async () => jsonResponse(200, { models: [{ name: 'llama3:latest' }, { name: 'qwen3:8b' }] })
    const ok = await mk(f as never).probe(new AbortController().signal)
    expect(ok).toEqual({ models: ['llama3:latest', 'qwen3:8b'], modelAvailable: true })
    expect((await mk(f as never, { model: 'mistral' }).probe(new AbortController().signal)).modelAvailable).toBe(false)
    const down = mk((async () => { throw new TypeError('fetch failed') }) as never)
    expect((await errorOf(down.probe(new AbortController().signal))).code).toBe('unavailable')
    const junk = mk((async () => jsonResponse(200, { nope: 1 })) as never)
    expect((await errorOf(junk.probe(new AbortController().signal))).code).toBe('bad_response')
  })
})

describe('Anthropic adapter', () => {
  const mk = (fetchImpl: typeof fetch, over: Record<string, unknown> = {}) => new AnthropicProvider({ apiKey: KEY, model: 'test-model', fetch: fetchImpl, maxRetries: 0, ...over })

  it('validates configuration', () => {
    expect(new AnthropicProvider({ apiKey: '', model: 'm' }).validate()?.code).toBe('not_configured')
    expect(new AnthropicProvider({ apiKey: KEY, model: '' }).validate()?.code).toBe('not_configured')
    expect(mk(vi.fn() as never).validate()).toBeNull()
  })

  it('streams text_delta events, usage and stop reason; uses the pinned host, x-api-key and the Messages shape', async () => {
    const f = vi.fn(async (_u: unknown, _i?: RequestInit) => anthropicStream(['Hel', 'lo [S1]'], { inputTokens: 40, outputTokens: 9 }))
    const ev = await collect(mk(f as never).stream(req()))
    expect(text(ev)).toBe('Hello [S1]')
    expect(ev.at(-1)).toEqual({ type: 'done', finish: 'stop', usage: { inputTokens: 40, outputTokens: 9 } })
    const [url, init] = f.mock.calls[0]!
    expect(String(url)).toBe('https://api.anthropic.com/v1/messages')
    const headers = new Headers(init?.headers)
    expect(headers.get('x-api-key')).toBe(KEY)
    expect(headers.get('anthropic-version')).toBeTruthy()
    const body = JSON.parse(String(init?.body))
    expect(body).toMatchObject({ model: 'test-model', max_tokens: 256, stream: true, system: 'sys' })
    // Optional sampling parameters are not sent: not every model accepts them.
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('top_p')
  })

  it('is not redirected by ANTHROPIC_BASE_URL', async () => {
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://evil.example')
    const f = vi.fn(async (_u: unknown) => anthropicStream(['x']))
    await collect(mk(f as never).stream(req()))
    expect(String(f.mock.calls[0]![0])).toMatch(/^https:\/\/api\.anthropic\.com\//)
    vi.unstubAllEnvs()
  })

  it('maps max_tokens to truncation and refusal to refusal', async () => {
    expect((await collect(mk((async () => anthropicStream(['a'], { stop: 'max_tokens' })) as never).stream(req()))).at(-1)).toMatchObject({ finish: 'length' })
    expect((await collect(mk((async () => anthropicStream(['I cannot help'], { stop: 'refusal' })) as never).stream(req()))).at(-1)).toMatchObject({ finish: 'refusal' })
  })

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [404, 'model_not_found'],
    [429, 'rate_limit'],
    [500, 'unavailable'],
    [529, 'unavailable'],
    [400, 'invalid_request']
  ])('maps HTTP %i to %s without leaking the key', async (status, code) => {
    const f = async () => jsonResponse(status, { type: 'error', error: { type: 'x', message: `bad key ${KEY}` } })
    const e = await errorOf(collect(mk(f as never).stream(req())))
    expect(e.code).toBe(code)
    expect(e.message).not.toContain(KEY)
    expect(JSON.stringify(e)).not.toContain(KEY)
  })

  it('maps network failure', async () => {
    const e = await errorOf(collect(mk((async () => { throw new TypeError('fetch failed') }) as never).stream(req())))
    expect(e.code).toBe('network')
  })

  it('retries a transient 429 a bounded number of times, honouring retry-after-ms', async () => {
    let n = 0
    const f = async () => (++n === 1 ? jsonResponse(429, { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }, { 'retry-after-ms': '1' }) : anthropicStream(['ok']))
    const ev = await collect(mk(f as never, { maxRetries: 2 }).stream(req()))
    expect(text(ev)).toBe('ok')
    expect(n).toBe(2)
    let m = 0
    const always = async () => (++m, jsonResponse(429, { type: 'error', error: { type: 'rate_limit_error', message: 'x' } }, { 'retry-after-ms': '1' }))
    expect((await errorOf(collect(mk(always as never, { maxRetries: 2 }).stream(req())))).code).toBe('rate_limit')
    expect(m).toBe(3)
  })

  it('rejects empty responses and malformed streams', async () => {
    const empty = await errorOf(collect(mk((async () => anthropicStream([])) as never).stream(req())))
    expect(empty.code).toBe('empty_response')
    const garbage = async () => new Response('event: content_block_delta\ndata: {broken\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } })
    expect((await errorOf(collect(mk(garbage as never).stream(req())))).code).toBe('bad_response')
  })

  it('cancels mid-stream without an error', async () => {
    const ac = new AbortController()
    const first = 'event: message_start\ndata: ' + JSON.stringify({ type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', content: [], model: 'x', stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } }) + '\n\nevent: content_block_delta\ndata: ' + JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'a' } }) + '\n\n'
    const f = async (_u: unknown, init?: RequestInit) => hangingStream(first, init?.signal)
    const got: StreamEvent[] = []
    for await (const e of mk(f as never).stream(req({ signal: ac.signal }))) {
      got.push(e)
      ac.abort()
    }
    expect(text(got)).toBe('a')
    expect(got.some((e) => e.type === 'done')).toBe(false)
  })

  it('probe: model available, model unavailable (lists alternatives), auth failure', async () => {
    const f = vi.fn(async (u: unknown) => {
      const url = String(u)
      if (url.endsWith('/v1/models/test-model')) return jsonResponse(200, { id: 'test-model', type: 'model', display_name: 'T', created_at: '2025-01-01T00:00:00Z' })
      return jsonResponse(200, { data: [{ id: 'other-model', type: 'model', display_name: 'O', created_at: '2025-01-01T00:00:00Z' }], has_more: false, first_id: 'other-model', last_id: 'other-model' })
    })
    expect(await mk(f as never).probe(new AbortController().signal)).toEqual({ models: ['test-model'], modelAvailable: true })
    const nf = async (u: unknown) => (String(u).endsWith('/v1/models/test-model') ? jsonResponse(404, { type: 'error', error: { type: 'not_found_error', message: 'nope' } }) : jsonResponse(200, { data: [{ id: 'other-model', type: 'model', display_name: 'O', created_at: '2025-01-01T00:00:00Z' }], has_more: false, first_id: 'other-model', last_id: 'other-model' }))
    expect(await mk(nf as never).probe(new AbortController().signal)).toEqual({ models: ['other-model'], modelAvailable: false })
    const bad = async () => jsonResponse(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } })
    expect((await errorOf(mk(bad as never).probe(new AbortController().signal))).code).toBe('auth')
  })
})

describe('OpenAI adapter (Responses API)', () => {
  const mk = (fetchImpl: typeof fetch, over: Record<string, unknown> = {}) => new OpenAiProvider({ apiKey: KEY, model: 'test-model', fetch: fetchImpl, maxRetries: 0, ...over })

  it('validates configuration', () => {
    expect(new OpenAiProvider({ apiKey: '', model: 'm' }).validate()?.code).toBe('not_configured')
    expect(new OpenAiProvider({ apiKey: KEY, model: '' }).validate()?.code).toBe('not_configured')
    expect(mk(vi.fn() as never).validate()).toBeNull()
  })

  it('streams response.output_text.delta events; uses /v1/responses, bearer auth, store:false', async () => {
    const f = vi.fn(async (_u: unknown, _i?: RequestInit) => openaiStream(['Hel', 'lo [S2]']))
    const ev = await collect(mk(f as never).stream(req()))
    expect(text(ev)).toBe('Hello [S2]')
    expect(ev.at(-1)).toEqual({ type: 'done', finish: 'stop', usage: { inputTokens: 31, outputTokens: 12 } })
    const [url, init] = f.mock.calls[0]!
    expect(String(url)).toBe('https://api.openai.com/v1/responses')
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${KEY}`)
    const body = JSON.parse(String(init?.body))
    expect(body).toMatchObject({ model: 'test-model', instructions: 'sys', stream: true, store: false, max_output_tokens: 256 })
    expect(body.input).toEqual([{ role: 'user', content: 'hi' }])
    expect(body).not.toHaveProperty('temperature')
  })

  it('is not redirected by OPENAI_BASE_URL', async () => {
    vi.stubEnv('OPENAI_BASE_URL', 'https://evil.example/v1')
    const f = vi.fn(async (_u: unknown) => openaiStream(['x']))
    await collect(mk(f as never).stream(req()))
    expect(String(f.mock.calls[0]![0])).toMatch(/^https:\/\/api\.openai\.com\//)
    vi.unstubAllEnvs()
  })

  it('maps incomplete (max_output_tokens) to truncation and response.failed to an error', async () => {
    expect((await collect(mk((async () => openaiStream(['a'], { incomplete: 'max_output_tokens' })) as never).stream(req()))).at(-1)).toMatchObject({ finish: 'length' })
    const e = await errorOf(collect(mk((async () => openaiStream(['a'], { failed: 'internal trouble' })) as never).stream(req())))
    expect(e.code).toBe('unavailable')
  })

  it.each([
    [401, 'auth'],
    [404, 'model_not_found'],
    [429, 'rate_limit'],
    [503, 'unavailable'],
    [400, 'invalid_request']
  ])('maps HTTP %i to %s without leaking the key', async (status, code) => {
    const f = async () => jsonResponse(status, { error: { message: `Incorrect API key provided: ${KEY}`, type: 'x', code: 'y' } })
    const e = await errorOf(collect(mk(f as never).stream(req())))
    expect(e.code).toBe(code)
    expect(JSON.stringify(e) + e.message).not.toContain(KEY)
  })

  it('maps network failure, empty output and truncated streams', async () => {
    expect((await errorOf(collect(mk((async () => { throw new TypeError('fetch failed') }) as never).stream(req())))).code).toBe('network')
    expect((await errorOf(collect(mk((async () => openaiStream([])) as never).stream(req())))).code).toBe('empty_response')
    const cut = async () => new Response('event: response.output_text.delta\ndata: ' + JSON.stringify({ type: 'response.output_text.delta', delta: 'x', sequence_number: 1, item_id: 'i', output_index: 0, content_index: 0, logprobs: [] }) + '\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } })
    expect((await errorOf(collect(mk(cut as never).stream(req())))).code).toBe('bad_response')
  })

  it('cancels mid-stream without an error', async () => {
    const ac = new AbortController()
    const first = 'event: response.output_text.delta\ndata: ' + JSON.stringify({ type: 'response.output_text.delta', delta: 'a', sequence_number: 1, item_id: 'i', output_index: 0, content_index: 0, logprobs: [] }) + '\n\n'
    const f = async (_u: unknown, init?: RequestInit) => hangingStream(first, init?.signal)
    const got: StreamEvent[] = []
    for await (const e of mk(f as never).stream(req({ signal: ac.signal }))) {
      got.push(e)
      ac.abort()
    }
    expect(text(got)).toBe('a')
  })

  it('probe: available / unavailable / auth failure', async () => {
    const model = { id: 'test-model', object: 'model', created: 1, owned_by: 'x' }
    const ok = async () => jsonResponse(200, model)
    expect(await mk(ok as never).probe(new AbortController().signal)).toEqual({ models: ['test-model'], modelAvailable: true })
    const nf = async (u: unknown) => (String(u).endsWith('/models/test-model') ? jsonResponse(404, { error: { message: 'no', type: 'invalid_request_error', code: 'model_not_found' } }) : jsonResponse(200, { object: 'list', data: [{ ...model, id: 'other' }] }))
    expect(await mk(nf as never).probe(new AbortController().signal)).toEqual({ models: ['other'], modelAvailable: false })
    const bad = async () => jsonResponse(401, { error: { message: `Incorrect API key ${KEY}`, type: 'invalid_request_error', code: 'invalid_api_key' } })
    const e = await errorOf(mk(bad as never).probe(new AbortController().signal))
    expect(e.code).toBe('auth')
    expect(e.message).not.toContain(KEY)
  })
})

describe('redaction', () => {
  it('removes known secrets and key-shaped tokens from text', () => {
    expect(redact(`oops ${KEY} and sk-abcdef123456 here`, [KEY])).not.toMatch(/sk-/)
    expect(redact('hello world', [KEY])).toBe('hello world')
  })
})
