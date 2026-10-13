/**
 * Phase 6 UI on the real stack: Ask Your Memory and the AI settings panel render the
 * output of the real retrieval and answer services (temporary database, mock
 * embeddings). Only the language model is scripted. This verifies what the interface
 * shows, links and refuses; it does not test a real model.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '@/app/App'
import { ProviderError, type StreamEvent } from '../../src/main/ai/provider'
import { bridgeFor, documentsBridgeFor, retrievalBridgeFor } from './helpers/db'
import { aiBridgeFor, aiHarness, type Harness } from './helpers/ai-setup'
import { FakeProvider, reply } from './helpers/ai-mocks'

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.scrollTo ??= () => {}
})

let h: Harness | null = null
afterEach(async () => {
  cleanup()
  location.hash = ''
  await h?.close()
  h = null
})

async function setup(script: ConstructorParameters<typeof FakeProvider>[0] | null, opts: { configure?: boolean } = {}) {
  const fake = new FakeProvider(script ?? reply('unused'))
  h = await aiHarness({ provider: () => fake })
  if (opts.configure !== false) await h.services.settings.update({ provider: 'ollama', ollama: { model: 'llama-test' } })
  const harness = h
  const ai = aiBridgeFor(async () => harness.services)
  const ui = () =>
    render(
      <App
        api={bridgeFor(() => harness.ws)}
        documentsApi={documentsBridgeFor(() => harness.docs)}
        retrievalApi={retrievalBridgeFor(() => harness.sem)}
        aiApi={ai}
        preferences={{ lang: 'en', reduceMotion: true }}
      />
    )
  return { h: harness, fake, ui }
}
const ask = async (q: string) => {
  const user = userEvent.setup()
  const box = await screen.findByLabelText('Your question')
  // The box is disabled until the provider settings have loaded; typing into it earlier is silently dropped.
  await waitFor(() => expect((box as HTMLTextAreaElement).disabled).toBe(false))
  await user.type(box, `${q}{Enter}`)
  return user
}

describe('Ask Your Memory with a configured provider', () => {
  it('shows the answer with citation chips that open the real note, plus the source list', async () => {
    const { h, ui } = await setup(reply('The Atlas budget is 40000 euros [S1].'))
    const id = await h.note('Atlas budget', 'The Atlas budget is 40000 euros for the year.')
    location.hash = '#/ask'
    ui()
    expect(await screen.findByText('llama-test')).toBeTruthy()
    const user = await ask('Atlas budget')
    const chip = await screen.findByRole('button', { name: 'Source S1: Atlas budget' })
    expect(await screen.findByText(/The Atlas budget is 40000 euros/, { selector: 'div' })).toBeTruthy()
    const sources = screen.getByRole('region', { name: 'Sources' })
    expect(within(sources).getByText('Atlas budget')).toBeTruthy()
    expect(within(sources).getByText(/for the year/)).toBeTruthy()
    expect(screen.getByText(/1 citations checked/)).toBeTruthy()
    await user.click(chip)
    await waitFor(() => expect(location.hash).toContain(`item=${encodeURIComponent(id)}`))
  })

  it('opens the cited PDF page', async () => {
    const { h, ui } = await setup(reply('Fit snow tyres before the trip [S1].'))
    const docId = await h.importPdf()
    location.hash = '#/ask'
    ui()
    const user = await ask('automobile snow tyres')
    const sources = await screen.findByRole('region', { name: 'Sources' })
    expect(within(sources).getByText('Page 2')).toBeTruthy()
    await user.click(within(sources).getByRole('button', { name: 'Open page 2' }))
    await waitFor(() => expect(location.hash).toContain(`/documents/${docId}?page=2`))
  })

  it('never turns an unknown citation into a link and says so', async () => {
    const { h, ui } = await setup(reply('Budget is 40000 [S1] and also [S9].'))
    await h.note('Atlas budget', 'The Atlas budget is 40000 euros.')
    location.hash = '#/ask'
    ui()
    await ask('Atlas budget')
    await screen.findByRole('button', { name: 'Source S1: Atlas budget' })
    expect(screen.queryByRole('button', { name: /S9/ })).toBeNull()
    expect(screen.getByTitle('Unknown source: not a link').textContent).toBe('[S9]')
    expect(screen.getByText(/never provided \(\[S9\]\)/)).toBeTruthy()
  })

  it('warns when an answer cites nothing', async () => {
    const { h, ui } = await setup(reply('It is probably around forty thousand euros, from general knowledge.'))
    await h.note('Atlas budget', 'The Atlas budget is 40000 euros.')
    location.hash = '#/ask'
    ui()
    await ask('Atlas budget')
    expect(await screen.findByText(/cites no source from your knowledge base/)).toBeTruthy()
  })

  it('answers honestly when nothing relevant exists, without calling the model', async () => {
    const { h, fake, ui } = await setup(reply('should not happen'))
    await h.note('Gardening', 'Tomatoes need sun.')
    location.hash = '#/ask'
    ui()
    await ask('quantum chromodynamics')
    expect(await screen.findByText(/does not contain enough evidence/)).toBeTruthy()
    expect(fake.calls).toHaveLength(0)
  })

  it('streams text, offers Stop, and marks a stopped answer as partial', async () => {
    const { h, ui } = await setup(async function* (req): AsyncGenerator<StreamEvent> {
      yield { type: 'delta', text: 'First half of the ans' }
      await new Promise<void>((res) => req.signal.addEventListener('abort', () => res()))
    })
    await h.note('Atlas budget', 'The Atlas budget is 40000 euros.')
    location.hash = '#/ask'
    ui()
    const user = await ask('Atlas budget')
    const live = await screen.findByTestId('live-answer')
    await within(live).findByText(/First half of the ans/)
    await user.click(await screen.findByRole('button', { name: 'Stop' }))
    expect(await screen.findByText(/Stopped by you\. This is a partial answer/)).toBeTruthy()
    expect(screen.getByText(/First half of the ans/)).toBeTruthy()
    // Ready for another question.
    await waitFor(() => expect((screen.getByLabelText('Your question') as HTMLTextAreaElement).disabled).toBe(false))
  })

  it('shows a provider failure in words and keeps the conversation', async () => {
    const { h, ui } = await setup(function* (): Generator<StreamEvent> {
      throw new ProviderError('rate_limit', 'x')
    })
    await h.note('Atlas budget', 'The Atlas budget is 40000 euros.')
    location.hash = '#/ask'
    ui()
    await ask('Atlas budget')
    expect(await screen.findByText(/rate limiting requests or your quota is used up/)).toBeTruthy()
    expect(h.makeCalls).toEqual(['ollama'])
  })

  it('lists conversations, switches between them, starts a new one and deletes one', async () => {
    const { h, ui } = await setup(reply('Fine [S1].'))
    await h.note('Atlas budget', 'The Atlas budget is 40000 euros.')
    await h.note('Hermes budget', 'The Hermes budget is 9000 euros.')
    location.hash = '#/ask'
    ui()
    const user = await ask('Atlas budget')
    const nav = await screen.findByRole('complementary', { name: 'Conversations' })
    await within(nav).findByRole('button', { name: 'Atlas budget' })
    await waitFor(() => expect((screen.getByLabelText('Your question') as HTMLTextAreaElement).disabled).toBe(false))
    await user.click(within(nav).getByRole('button', { name: 'New conversation' }))
    expect(screen.queryByText('Fine')).toBeNull()
    await user.type(screen.getByLabelText('Your question'), 'Hermes budget{Enter}')
    await within(nav).findByRole('button', { name: 'Hermes budget' })
    await waitFor(() => expect(within(nav).getAllByRole('listitem')).toHaveLength(2))
    await user.click(within(nav).getByRole('button', { name: 'Atlas budget' }))
    await waitFor(() => expect(screen.getAllByText('Atlas budget').length).toBeGreaterThan(1))
    await user.click(within(nav).getByRole('button', { name: 'Delete conversation: Atlas budget' }))
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(within(nav).queryByRole('button', { name: 'Atlas budget' })).toBeNull())
    expect(within(nav).getByRole('button', { name: 'Hermes budget' })).toBeTruthy()
    expect(h.ws.loadWorkspace().items).toHaveLength(2) // notes untouched
  })

  it('marks a citation as no longer available after its note is deleted', async () => {
    const { h, ui } = await setup(reply('Budget is 40000 [S1].'))
    const id = await h.note('Atlas budget', 'The Atlas budget is 40000 euros.')
    location.hash = '#/ask'
    const view = ui()
    const user = await ask('Atlas budget')
    await screen.findByRole('button', { name: 'Source S1: Atlas budget' })
    h.ws.deleteItem(id)
    view.unmount()
    location.hash = '#/ask'
    ui()
    const nav = await screen.findByRole('complementary', { name: 'Conversations' })
    await user.click(await within(nav).findByRole('button', { name: 'Atlas budget' }))
    expect((await screen.findAllByText('No longer available')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Source S1: Atlas budget' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open source' })).toBeNull()
    expect(screen.getByText(/The Atlas budget is 40000 euros/, { selector: 'blockquote' })).toBeTruthy() // the cited excerpt is kept
  })
})

describe('Ask without a ready provider', () => {
  it('explains what is missing, links to Settings and does not allow asking', async () => {
    const { ui } = await setup(null, { configure: false })
    location.hash = '#/ask'
    ui()
    expect(await screen.findByText('No AI provider is ready')).toBeTruthy()
    expect(screen.getAllByRole('link', { name: 'Open AI settings' })[0]!.getAttribute('href')).toContain('/settings#ai')
    expect((screen.getByLabelText('Your question') as HTMLTextAreaElement).disabled).toBe(true)
  })

  it('discloses cloud processing when a cloud provider is active', async () => {
    const { h, ui } = await setup(reply('x'), { configure: false })
    await h.services.credentials.save('anthropic', 'sk-ant-test-0000000000')
    await h.services.settings.update({ anthropic: { model: 'm' }, cloudAcknowledged: { anthropic: true }, provider: 'anthropic' })
    location.hash = '#/ask'
    ui()
    expect(await screen.findByText(/Cloud provider: your question, the passages found for it and the recent conversation are sent to Anthropic/)).toBeTruthy()
  })
})

describe('Settings: AI provider', () => {
  const KEY = 'sk-ant-test-INTERFACESECRET0123'

  it('walks through key, consent, test and activation without ever showing the key again', async () => {
    const { h, ui } = await setup(reply('x'), { configure: false })
    location.hash = '#/settings'
    ui()
    const user = userEvent.setup()
    const panel = await screen.findByRole('region', { name: 'AI provider' })
    await user.click(await within(panel).findByRole('radio', { name: /Anthropic/ }))
    const use = within(panel).getByRole('button', { name: 'Use for Ask Your Memory' }) as HTMLButtonElement
    expect(use.disabled).toBe(true)
    expect(within(panel).getByText('Enter a model first.')).toBeTruthy()

    await user.type(within(panel).getByLabelText('Model'), 'my-model')
    await user.tab()
    await user.type(within(panel).getByLabelText('API key'), KEY)
    expect((within(panel).getByLabelText('API key') as HTMLInputElement).type).toBe('password')
    await user.click(within(panel).getByRole('button', { name: 'Save key' }))
    expect(await within(panel).findByText('A key is saved')).toBeTruthy()
    // After saving, the key is nowhere in the interface and not in any setting returned by main.
    expect(document.body.innerHTML).not.toContain('INTERFACESECRET')
    expect(JSON.stringify(await h.services.settings.view())).not.toContain('INTERFACESECRET')

    // Consent is required before the provider can be used.
    expect((within(panel).getByRole('button', { name: 'Use for Ask Your Memory' }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(within(panel).getByRole('switch'))
    await waitFor(() => expect((within(panel).getByRole('button', { name: 'Use for Ask Your Memory' }) as HTMLButtonElement).disabled).toBe(false))

    expect(within(panel).getByText('Not tested yet')).toBeTruthy()
    await user.click(within(panel).getByRole('button', { name: 'Test connection' }))
    expect(await within(panel).findByText(/Connection works and model “my-model” is available/)).toBeTruthy()

    await user.click(within(panel).getByRole('button', { name: 'Use for Ask Your Memory' }))
    expect(await within(panel).findByText('Ask Your Memory uses Anthropic.')).toBeTruthy()
    expect((await h.services.settings.view()).provider).toBe('anthropic')

    // Removing the key (confirmed) clears it.
    await user.click(within(panel).getByRole('button', { name: 'Remove key' }))
    await user.click(await screen.findByRole('button', { name: 'Remove key', hidden: false }))
    await waitFor(() => expect(h.services.credentials.info('anthropic').state).toBe('none'))
  })

  it('refuses a non-local Ollama address and shows the reason', async () => {
    const { h, ui } = await setup(reply('x'), { configure: false })
    location.hash = '#/settings'
    ui()
    const user = userEvent.setup()
    const panel = await screen.findByRole('region', { name: 'AI provider' })
    const input = await within(panel).findByLabelText('Ollama address')
    await user.clear(input)
    await user.type(input, 'http://192.168.1.20:11434')
    await user.tab()
    expect(await within(panel).findByText(/Only a local Ollama/)).toBeTruthy()
    expect(h.services.settings.load().ollama.baseUrl).toBe('http://127.0.0.1:11434')
  })

  it('reports a failed connection test without claiming a connection', async () => {
    const fake = new FakeProvider(reply('x'))
    fake.probe = async () => {
      throw new (await import('../../src/main/ai/provider')).ProviderError('unavailable', 'down')
    }
    h = await aiHarness({ provider: () => fake })
    const harness = h
    await harness.services.settings.update({ ollama: { model: 'llama-test' } })
    location.hash = '#/settings'
    render(<App api={bridgeFor(() => harness.ws)} documentsApi={documentsBridgeFor(() => harness.docs)} retrievalApi={retrievalBridgeFor(() => harness.sem)} aiApi={aiBridgeFor(async () => harness.services)} preferences={{ lang: 'en', reduceMotion: true }} />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Test connection' }))
    const panel = screen.getByRole('region', { name: 'AI provider' })
    expect(await within(panel).findByText(/Connection failed: The provider is not available/)).toBeTruthy()
    expect(within(panel).queryByText(/Connection works/)).toBeNull()
  })
})
