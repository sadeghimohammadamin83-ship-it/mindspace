/**
 * Phase 5 UI: Ask Your Memory, global search and Settings on a real
 * temporary database with the real retrieval service. Embeddings are
 * DETERMINISTIC MOCKS (helpers/mock-embeddings.ts): this checks the evidence
 * UI, grounding links and states, not model quality.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { App } from '@/app/App'
import { closeDatabase, openDatabase } from '../../src/main/db/connection'
import { createWorkspaceService } from '../../src/main/services/workspace-service'
import { createDocumentService } from '../../src/main/services/document-service'
import { extractPdf } from '../../src/main/documents/extract'
import { createSemanticService } from '../../src/main/semantic/semantic-service'
import { bridgeFor, documentsBridgeFor, retrievalBridgeFor, tempDir } from './helpers/db'
import { MOCK_DIMS, MockProvider } from './helpers/mock-embeddings'

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.scrollTo ??= () => {}
})
afterEach(() => {
  cleanup()
  location.hash = ''
})

async function setup(provider = new MockProvider()) {
  const tmp = tempDir()
  const db = openDatabase(tmp.file)
  const dir = join(tmp.dir, 'documents')
  mkdirSync(dir)
  const sem = createSemanticService({
    db,
    store: { dir: '/none', totalBytes: 123_000_000, isInstalled: async () => true, verify: async () => true, download: async () => undefined },
    createProvider: () => provider,
    model: { modelId: provider.info.modelId, displayName: 'mock', license: 'test', dimensions: MOCK_DIMS, source: 'test' },
    tuning: { minScore: 0.5, margin: 0.5 },
    debounceMs: 0
  })
  const picks: { next: string[] | null } = { next: null }
  const docs = createDocumentService({
    db,
    dir,
    selectFiles: async () => picks.next,
    extractPdf: async (p) => extractPdf(new Uint8Array(readFileSync(p))),
    onChange: () => sem.notifyChanged()
  })
  const ws = createWorkspaceService(db)
  await sem.start()
  const done = async () => {
    cleanup()
    await sem.close()
    closeDatabase(db)
    tmp.cleanup()
  }
  return { db, docs, ws, sem, picks, done, data: bridgeFor(() => ws), documents: documentsBridgeFor(() => docs), retrieval: retrievalBridgeFor(() => sem) }
}
type S = Awaited<ReturnType<typeof setup>>
const renderApp = (s: S) =>
  render(<App api={s.data} documentsApi={s.documents} retrievalApi={s.retrieval} preferences={{ lang: 'en', reduceMotion: true }} />)
const note = (s: S, title: string, body: string) => s.ws.createItem({ kind: 'note', title, body, url: '', tagLabels: [], projectId: null }).items[0]!.id

describe('global search', () => {
  it('adds a "Related by meaning" group for sources the keyword groups miss', async () => {
    const s = await setup()
    try {
      note(s, 'Vehicle upkeep', 'The automobile needs new tyres.')
      await s.sem.idle()
      renderApp(s)
      const user = userEvent.setup()
      await user.type(await screen.findByRole('combobox', { name: 'Global search' }), 'car')
      const group = await screen.findByRole('group', { name: 'Related by meaning' }, { timeout: 3000 })
      await user.click(within(group).getByText('Vehicle upkeep'))
      await waitFor(() => expect(location.hash).toContain('item='))
    } finally {
      await s.done()
    }
  })
})

describe('Settings', () => {
  it('shows the local model and index state', async () => {
    const s = await setup()
    try {
      note(s, 'One', 'car')
      await s.sem.idle()
      location.hash = '#/settings'
      renderApp(s)
      const panel = await screen.findByRole('region', { name: 'Semantic search' })
      expect(await within(panel).findByText('Ready')).toBeTruthy()
      expect(within(panel).getByText(/never leave this computer/)).toBeTruthy()
      expect(await within(panel).findByText(/1 sources · 1 passages/)).toBeTruthy()
    } finally {
      await s.done()
    }
  })
})
