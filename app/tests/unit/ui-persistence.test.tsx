import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DataBridge } from '@shared/ipc'
import { App } from '@/app/App'
import { closeDatabase, openDatabase } from '../../src/main/db/connection'
import { seedSampleDataIfNew } from '../../src/main/db/seed'
import { createWorkspaceService } from '../../src/main/services/workspace-service'
import { bridgeFor, tempDir } from './helpers/db'

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

const renderApp = (api: DataBridge | null) =>
  render(<App api={api} preferences={{ lang: 'en', reduceMotion: true }} />)

describe('UI reads and writes through the data layer', () => {
  it('captures a note into SQLite, and it is still there after reopening the database', async () => {
    const tmp = tempDir()
    try {
      const db = openDatabase(tmp.file)
      seedSampleDataIfNew(db)
      const svc = createWorkspaceService(db)
      location.hash = '#/capture'
      renderApp(bridgeFor(() => svc))
      const title = await screen.findByLabelText(/^Title/)
      const user = userEvent.setup()
      await user.type(title, 'Persisted from the UI')
      await user.click(screen.getByRole('button', { name: /^Save/ }))
      await waitFor(() =>
        expect(db.prepare('SELECT title, origin FROM items WHERE title = ?').get('Persisted from the UI')).toEqual({
          title: 'Persisted from the UI',
          origin: 'user'
        })
      )
      cleanup()
      closeDatabase(db)

      const reopened = openDatabase(tmp.file)
      const svc2 = createWorkspaceService(reopened)
      location.hash = '#/library'
      renderApp(bridgeFor(() => svc2))
      expect(await screen.findByText('Persisted from the UI')).toBeTruthy()
      cleanup()
      closeDatabase(reopened)
    } finally {
      tmp.cleanup()
    }
  })

  it('shows only what the database holds (no mock arrays)', async () => {
    const db = openDatabase(':memory:')
    const svc = createWorkspaceService(db)
    svc.createProject({ name: 'Only project in the DB', description: '', status: 'active' })
    location.hash = '#/projects'
    renderApp(bridgeFor(() => svc))
    expect(await screen.findByText('Only project in the DB')).toBeTruthy()
    expect(screen.queryByText('ساخت MINDSPACE')).toBeNull()
  })

  it('completing a task persists it and updates the screen', async () => {
    const db = openDatabase(':memory:')
    const svc = createWorkspaceService(db)
    const t = svc.createTask({ title: 'Finish chapter', notes: '', status: 'todo', priority: 'high', dueDate: null, projectId: null }).tasks[0]!
    location.hash = '#/tasks'
    renderApp(bridgeFor(() => svc))
    const row = (await screen.findByText('Finish chapter')).closest('[data-task-row], li, div')!
    const toggle = within(row as HTMLElement).queryByRole('checkbox') ?? screen.getAllByRole('checkbox')[0]!
    await act(async () => userEvent.setup().click(toggle))
    await waitFor(() => expect(svc.getTask(t.id).status).toBe('done'))
    expect(svc.getTask(t.id).completedAt).not.toBeNull()
  })

  it('shows a failed save as not saved and keeps the form', async () => {
    const db = openDatabase(':memory:')
    const svc = createWorkspaceService(db)
    const api = bridgeFor(() => svc)
    const failing: DataBridge = {
      ...api,
      createItem: async () => ({ ok: false, error: { code: 'internal', message: 'disk full' } })
    }
    location.hash = '#/capture'
    renderApp(failing)
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText(/^Title/), 'Will fail')
    await user.click(screen.getByRole('button', { name: /^Save/ }))
    expect(await screen.findByText('Not saved')).toBeTruthy()
    expect((screen.getByLabelText(/^Title/) as HTMLInputElement).value).toBe('Will fail')
    expect(svc.loadWorkspace().items).toEqual([])
  })

  it('shows loading, then an error state without the app when storage fails', async () => {
    let fail!: () => void
    const api = {
      loadWorkspace: () => new Promise((resolve) => (fail = () => resolve({ ok: false, error: { code: 'unavailable', message: 'x' } })))
    } as unknown as DataBridge
    renderApp(api)
    expect(screen.getByRole('status').textContent).toMatch(/Loading/)
    await act(async () => fail())
    expect(await screen.findByText('Your data could not be opened')).toBeTruthy()
    expect(screen.queryByRole('navigation')).toBeNull()
  })
})
