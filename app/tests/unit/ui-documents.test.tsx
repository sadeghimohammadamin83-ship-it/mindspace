import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { App } from '@/app/App'
import { closeDatabase, openDatabase } from '../../src/main/db/connection'
import { seedSampleDataIfNew } from '../../src/main/db/seed'
import { createWorkspaceService } from '../../src/main/services/workspace-service'
import { createDocumentService } from '../../src/main/services/document-service'
import { extractPdf } from '../../src/main/documents/extract'
import { bridgeFor, documentsBridgeFor, tempDir } from './helpers/db'

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

const FIX = resolve(__dirname, '../fixtures/documents')

/** Real service, temporary database and folder; the "dialog" returns fixture paths. */
function setup() {
  const tmp = tempDir()
  const db = openDatabase(tmp.file)
  seedSampleDataIfNew(db)
  const dir = join(tmp.dir, 'documents')
  mkdirSync(dir)
  const picks: { next: string[] | null } = { next: null }
  const docs = createDocumentService({
    db,
    dir,
    selectFiles: async () => picks.next,
    extractPdf: async (p) => extractPdf(new Uint8Array(readFileSync(p)))
  })
  const ws = createWorkspaceService(db)
  const done = () => {
    cleanup()
    closeDatabase(db)
    tmp.cleanup()
  }
  return { db, docs, ws, picks, done, data: bridgeFor(() => ws), documents: documentsBridgeFor(() => docs) }
}

const renderApp = (s: ReturnType<typeof setup>) =>
  render(<App api={s.data} documentsApi={s.documents} preferences={{ lang: 'en', reduceMotion: true }} />)

describe('Documents UI on real persisted data', () => {
  it('imports through the dialog flow, shows status, and lists real records', async () => {
    const s = setup()
    try {
      location.hash = '#/documents'
      renderApp(s)
      expect(await screen.findByText('No documents yet')).toBeTruthy()
      s.picks.next = [join(FIX, 'sample-document.md'), join(FIX, 'sample-scanned.pdf'), join(FIX, 'sample-document.md')]
      const user = userEvent.setup()
      await user.click(screen.getAllByRole('button', { name: /Import documents/ })[0]!)
      await waitFor(() => expect(screen.getByRole('link', { name: 'sample-document' })).toBeTruthy())
      expect(await screen.findByText('1 already in your library', { exact: false })).toBeTruthy()
      await waitFor(() => expect(screen.getByText('No searchable text')).toBeTruthy(), { timeout: 5000 })
      await waitFor(() => expect(screen.getByText('Searchable')).toBeTruthy(), { timeout: 5000 })
    } finally {
      s.done()
    }
  })

  it('opens a PDF search hit at the right page from global search, with highlighted text', async () => {
    const s = setup()
    try {
      s.picks.next = [join(FIX, 'sample-multipage.pdf')]
      await s.docs.importDocuments()
      await s.docs.idle()
      location.hash = '#/'
      renderApp(s)
      const user = userEvent.setup()
      const box = await screen.findByRole('combobox')
      await user.type(box, 'zephyr quartz')
      const option = await screen.findByRole('option', { name: /sample-multipage.*Page 3/ }, { timeout: 3000 })
      await user.click(option)
      await waitFor(() => expect(location.hash).toContain('/documents/'))
      expect(location.hash).toContain('page=3')
      expect(await screen.findByText('Page 3 of 5')).toBeTruthy()
      const text = await screen.findByTestId('document-text')
      await waitFor(() => expect(text.textContent).toContain('zephyr quartz ledger'))
      expect([...text.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['zephyr', 'quartz'])
      // Page navigation
      await user.click(screen.getByRole('button', { name: 'Next page' }))
      expect(await screen.findByText('Page 4 of 5')).toBeTruthy()
      expect(await screen.findByText('This page has no extractable text.')).toBeTruthy()
    } finally {
      s.done()
    }
  })

  it('explains image-only PDFs and failed encrypted PDFs instead of showing invented text', async () => {
    const s = setup()
    try {
      s.picks.next = [join(FIX, 'sample-scanned.pdf'), join(FIX, 'sample-encrypted.pdf')]
      const r = await s.docs.importDocuments()
      await s.docs.idle()
      const ids = !r.cancelled ? r.results.map((x) => (x.outcome === 'imported' ? x.document.id : '')) : []
      location.hash = `#/documents/${ids[0]}`
      renderApp(s)
      expect(await screen.findByText(/OCR\) is not supported yet/)).toBeTruthy()
      cleanup()
      location.hash = `#/documents/${ids[1]}`
      renderApp(s)
      expect(await screen.findByText(/password-protected/)).toBeTruthy()
      expect(screen.getByRole('button', { name: /Try again/ })).toBeTruthy()
      expect(screen.queryByTestId('document-text')).toBeNull()
    } finally {
      s.done()
    }
  })

  it('removes a document after confirmation; it disappears from search', async () => {
    const s = setup()
    try {
      s.picks.next = [join(FIX, 'sample-document.txt')]
      const r = await s.docs.importDocuments()
      await s.docs.idle()
      const id = !r.cancelled && r.results[0]!.outcome === 'imported' ? r.results[0]!.document.id : ''
      location.hash = `#/documents/${id}`
      renderApp(s)
      const user = userEvent.setup()
      await user.click(await screen.findByRole('button', { name: 'Remove' }))
      const dialog = await screen.findByRole('dialog')
      await user.click(within(dialog).getByRole('button', { name: 'Remove' }))
      await waitFor(() => expect(location.hash).toBe('#/documents'))
      expect(s.docs.list()).toEqual([])
      expect(s.docs.search({ text: 'cobalt' }).total).toBe(0)
    } finally {
      s.done()
    }
  })

  it('renders snippet text literally, never as HTML', async () => {
    const s = setup()
    try {
      s.picks.next = [join(FIX, 'sample-document.md')]
      await s.docs.importDocuments()
      await s.docs.idle()
      location.hash = '#/documents?q=alert'
      renderApp(s)
      const panel = await screen.findByText('Matches inside documents', {}, { timeout: 3000 })
      const region = panel.closest('section')!
      await waitFor(() => expect(region.textContent).toContain('<script>'))
      expect(document.querySelector('script')).toBeNull()
    } finally {
      s.done()
    }
  })
})
