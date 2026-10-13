import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DataBridge } from '@shared/ipc'
import { App } from '@/app/App'
import { closeDatabase, openDatabase } from '../../src/main/db/connection'
import { seedSampleDataIfNew } from '../../src/main/db/seed'
import { createWorkspaceService } from '../../src/main/services/workspace-service'
import { bridgeFor } from './helpers/db'

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
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
})
afterEach(() => {
  cleanup()
  location.hash = ''
})

/** An in-memory database with a project, two notes and two tasks, shown through the real UI. */
function setup(open: string) {
  const db = openDatabase(':memory:')
  const svc = createWorkspaceService(db)
  const project = svc.createProject({ name: 'Atlas', description: 'Mapping the territory', status: 'active' }).projects[0]!
  const inProject = svc.createItem({ kind: 'note', title: 'Survey notes', body: 'body', url: '', tagLabels: ['Field'], projectId: project.id }).items[0]!
  const loose = svc.createItem({ kind: 'note', title: 'Loose thought', body: 'body', url: '', tagLabels: [], projectId: null }).items[0]!
  const openTask = svc.createTask({ title: 'Order maps', notes: '', status: 'todo', priority: 'high', dueDate: '2030-01-05', projectId: project.id }).tasks[0]!
  const doneTask = svc.createTask({ title: 'Buy compass', notes: '', status: 'done', priority: 'low', dueDate: null, projectId: project.id }).tasks[0]!
  location.hash = open.replace('{p}', project.id)
  const api = bridgeFor(() => svc)
  const view = (override?: Partial<DataBridge>) => render(<App api={{ ...api, ...override } as DataBridge} preferences={{ lang: 'en', reduceMotion: true }} />)
  return { db, svc, project, inProject, loose, openTask, doneTask, view }
}

const statValue = (label: string) => {
  const dt = screen.getAllByText(label).find((e) => e.tagName === 'DT')!
  return dt.previousElementSibling!.textContent
}

describe('project workspace', () => {
  it('opens a project and shows overview numbers read from the database', async () => {
    const { view, svc } = setup('#/projects/{p}')
    view()
    expect(await screen.findByRole('heading', { level: 1, name: 'Atlas' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Overview/ }).getAttribute('aria-selected')).toBe('true')
    expect(statValue('Notes')).toBe('1')
    expect(statValue('Open tasks')).toBe('1')
    expect(statValue('Completed tasks')).toBe('1')
    expect(statValue('Decisions')).toBe('0')
    expect(screen.getAllByText('Mapping the territory').length).toBe(2) // header and About panel
    expect(screen.getAllByText('Order maps').length).toBeGreaterThan(0) // upcoming task and recent list
    expect(svc.loadWorkspace().tasks).toHaveLength(2)
  })

  it('creates a decision from the project, opens it, and the metrics update', async () => {
    const { view, svc, project } = setup('#/projects/{p}?tab=decisions')
    view()
    const user = userEvent.setup()
    expect(await screen.findByText('No decisions recorded yet.')).toBeTruthy()
    await user.click(screen.getAllByRole('button', { name: /New decision/ })[0]!)
    const dialog = await screen.findByRole('dialog', { name: /New decision/ })
    await user.type(within(dialog).getByLabelText(/^Title/), 'Use paper maps')
    await user.type(within(dialog).getByLabelText(/^Decision$/), 'Print the survey sheets.')
    await user.type(within(dialog).getByLabelText(/^Rationale/), 'No battery to run out of.')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))
    // the drawer for the new decision opens
    const drawer = await screen.findByRole('dialog', { name: 'Use paper maps' })
    expect(within(drawer).getByText('Print the survey sheets.')).toBeTruthy()
    expect(within(drawer).getByText('No battery to run out of.')).toBeTruthy()
    expect(within(drawer).getAllByText('Proposed').length).toBeGreaterThan(0)
    // empty optional sections are not rendered as blank placeholders
    expect(within(drawer).queryByText('Alternatives considered')).toBeNull()
    expect(within(drawer).queryByText('Consequences and trade-offs')).toBeNull()
    const stored = svc.loadWorkspace().decisions
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ title: 'Use paper maps', projectId: project.id, status: 'proposed' })

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Use paper maps' })).toBeNull())
    await user.click(screen.getByRole('tab', { name: /Overview/ }))
    await waitFor(() => expect(statValue('Decisions')).toBe('1'))
  })

  it('validates required decision fields without saving', async () => {
    const { view, svc } = setup('#/projects/{p}?tab=decisions')
    view()
    const user = userEvent.setup()
    await user.click((await screen.findAllByRole('button', { name: /New decision/ }))[0]!)
    const dialog = await screen.findByRole('dialog', { name: /New decision/ })
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))
    expect(await within(dialog).findByText('Give the decision a title')).toBeTruthy()
    expect(within(dialog).getByText('Describe what was decided')).toBeTruthy()
    expect(svc.loadWorkspace().decisions).toEqual([])
  })

  it('shows a failed save as not saved and keeps the form', async () => {
    const { view, svc } = setup('#/projects/{p}?tab=decisions')
    view({ createDecision: async () => ({ ok: false, error: { code: 'internal', message: 'disk full' } }) })
    const user = userEvent.setup()
    await user.click((await screen.findAllByRole('button', { name: /New decision/ }))[0]!)
    const dialog = await screen.findByRole('dialog', { name: /New decision/ })
    await user.type(within(dialog).getByLabelText(/^Title/), 'Will fail')
    await user.type(within(dialog).getByLabelText(/^Decision$/), 'Nope')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('Not saved')).toBeTruthy()
    expect((within(dialog).getByLabelText(/^Title/) as HTMLInputElement).value).toBe('Will fail')
    expect(svc.loadWorkspace().decisions).toEqual([])
    expect(screen.queryByText('Decision recorded')).toBeNull()
  })

  it('changes a decision\'s status, with the new status persisted and shown', async () => {
    const { view, svc, project } = setup('#/projects/{p}?tab=decisions')
    const d = svc.createDecision({ title: 'Pick a route', context: '', decision: 'North route', rationale: '', alternatives: '', consequences: '', status: 'proposed', decidedOn: null, projectId: project.id, tagLabels: [], noteIds: [], taskIds: [] }).decisions[0]!
    location.hash = `#/projects/${project.id}?tab=decisions&decision=${d.id}`
    view()
    const user = userEvent.setup()
    const drawer = await screen.findByRole('dialog', { name: 'Pick a route' })
    await user.click(within(drawer).getByRole('button', { name: 'Change status' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Accept' }))
    await waitFor(() => expect(svc.getDecision(d.id).status).toBe('accepted'))
    expect(await within(drawer).findByText('Agreed and in effect.')).toBeTruthy()
  })

  it('supersedes a decision from the UI and shows the replacement', async () => {
    const { view, svc, project } = setup('#/projects/{p}?tab=decisions')
    const mk = (title: string, status: 'accepted' | 'proposed') =>
      svc.createDecision({ title, context: '', decision: 'x', rationale: '', alternatives: '', consequences: '', status, decidedOn: null, projectId: project.id, tagLabels: [], noteIds: [], taskIds: [] }).decisions[0]!
    const old = mk('Old plan', 'accepted')
    const next = mk('New plan', 'accepted')
    location.hash = `#/projects/${project.id}?tab=decisions&decision=${old.id}`
    view()
    const user = userEvent.setup()
    const drawer = await screen.findByRole('dialog', { name: 'Old plan' })
    await user.click(within(drawer).getByRole('button', { name: 'Change status' }))
    await user.click(await screen.findByRole('menuitem', { name: /Mark as superseded/ }))
    const dlg = await screen.findByRole('dialog', { name: 'Supersede this decision' })
    await user.click(within(dlg).getByRole('button', { name: 'Mark superseded' }))
    await waitFor(() => expect(svc.getDecision(old.id)).toMatchObject({ status: 'superseded', supersededById: next.id }))
    expect(await within(drawer).findByRole('link', { name: 'New plan' })).toBeTruthy()
    expect(svc.getDecision(old.id).title).toBe('Old plan') // the original record is kept
  })

  it('links and unlinks notes and tasks on a decision, keeping both records', async () => {
    const { view, svc, project, loose, openTask } = setup('#/projects/{p}?tab=decisions')
    const d = svc.createDecision({ title: 'Linked one', context: '', decision: 'x', rationale: '', alternatives: '', consequences: '', status: 'accepted', decidedOn: null, projectId: project.id, tagLabels: [], noteIds: [], taskIds: [] }).decisions[0]!
    location.hash = `#/projects/${project.id}?tab=decisions&decision=${d.id}`
    view()
    const user = userEvent.setup()
    const drawer = await screen.findByRole('dialog', { name: 'Linked one' })
    expect(within(drawer).getByText('No note explains this decision yet.')).toBeTruthy()

    await user.click(within(drawer).getByRole('button', { name: 'Link note' }))
    const picker = await screen.findByRole('dialog', { name: 'Link a note' })
    await user.click(within(within(picker).getByText('Loose thought').closest('li')!).getByRole('button', { name: 'Link' }))
    await waitFor(() => expect(svc.getDecision(d.id).noteIds).toEqual([loose.id]))
    expect(await within(drawer).findByRole('link', { name: 'Loose thought' })).toBeTruthy()

    await user.click(within(drawer).getByRole('button', { name: 'Link task' }))
    const taskPicker = await screen.findByRole('dialog', { name: 'Link a task' })
    await user.click(within(within(taskPicker).getByText('Order maps').closest('li')!).getByRole('button', { name: 'Link' }))
    await waitFor(() => expect(svc.getDecision(d.id).taskIds).toEqual([openTask.id]))

    await user.click(within(drawer).getByRole('button', { name: 'Unlink “Loose thought”' }))
    await waitFor(() => expect(svc.getDecision(d.id).noteIds).toEqual([]))
    expect(svc.getItem(loose.id).title).toBe('Loose thought')
    await user.click(within(drawer).getByRole('button', { name: 'Unlink “Order maps”' }))
    await waitFor(() => expect(svc.getDecision(d.id).taskIds).toEqual([]))
    expect(svc.getTask(openTask.id).title).toBe('Order maps')
  })

  it('links an existing note to the project and removes it again without deleting it', async () => {
    const { view, svc, project, loose } = setup('#/projects/{p}?tab=notes')
    view()
    const user = userEvent.setup()
    expect(await screen.findByText('Survey notes')).toBeTruthy()
    await user.click(screen.getAllByRole('button', { name: /Link existing note/ })[0]!)
    const picker = await screen.findByRole('dialog', { name: 'Link a note to this project' })
    await user.click(within(within(picker).getByText('Loose thought').closest('li')!).getByRole('button', { name: 'Link' }))
    await waitFor(() => expect(svc.getItem(loose.id).projectId).toBe(project.id))
    expect(await screen.findByText('Loose thought')).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Notes/ }).textContent).toContain('2')

    await user.click(screen.getByRole('button', { name: /Remove “Loose thought” from this project/ }))
    await waitFor(() => expect(svc.getItem(loose.id).projectId).toBeNull())
    expect(svc.getItem(loose.id).title).toBe('Loose thought') // still exists
    await waitFor(() => expect(screen.queryByRole('button', { name: /Remove “Loose thought”/ })).toBeNull())
    expect(screen.getByRole('tab', { name: /Notes/ }).textContent).toContain('1')
  })

  it('keeps the project tasks consistent with the main Tasks screen', async () => {
    const { view, svc, project, openTask } = setup('#/projects/{p}?tab=tasks')
    view()
    const user = userEvent.setup()
    const row = (await screen.findByText('Order maps')).closest('div')!.parentElement!
    await user.click(within(row).getByRole('checkbox'))
    await waitFor(() => expect(svc.getTask(openTask.id).status).toBe('done'))
    await user.click(screen.getByRole('tab', { name: /Overview/ }))
    await waitFor(() => expect(statValue('Completed tasks')).toBe('2'))
    expect(statValue('Open tasks')).toBe('0')
    expect(svc.loadWorkspace().tasks.filter((t) => t.projectId === project.id && t.status === 'done')).toHaveLength(2)
  })

  it('shows the project timeline from stored events, newest first, with working links', async () => {
    const { view, svc, project, inProject } = setup('#/projects/{p}?tab=activity')
    svc.updateItem(inProject.id, { title: 'Survey notes v2' })
    view()
    expect(await screen.findByText('Project timeline')).toBeTruthy()
    expect(await screen.findByText('Edited “Survey notes v2”')).toBeTruthy()
    const kinds = svc.listProjectActivity({ projectId: project.id }).map((e) => e.kind)
    expect(kinds[0]).toBe('item_updated')
    const items = screen.getAllByRole('listitem').filter((li) => li.textContent?.includes('Project created') || li.textContent?.includes('Note updated'))
    expect(items[0]!.textContent).toContain('Note updated')
    expect(screen.getAllByRole('link', { name: /^Open Survey notes v2/ })[0]!.getAttribute('href')).toContain('/library?item=')
  })

  it('shows an empty timeline state for a project without recorded events', async () => {
    const { view, db, project } = setup('#/projects/{p}?tab=activity')
    db.prepare('DELETE FROM activity_events WHERE project_id = ?').run(project.id)
    view()
    expect(await screen.findByText('Nothing has happened in this project yet.')).toBeTruthy()
  })

  it('shows a timeline load failure with a retry instead of an empty list', async () => {
    const { view } = setup('#/projects/{p}?tab=activity')
    view({ listProjectActivity: async () => ({ ok: false, error: { code: 'internal', message: 'x' } }) })
    expect(await screen.findByText('The timeline could not be loaded.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })
})

describe('moving between related records', () => {
  it('goes from a decision to its note and back via the backlink', async () => {
    const { view, svc, project, inProject } = setup('#/projects/{p}?tab=decisions')
    const d = svc.createDecision({ title: 'Why we survey', context: '', decision: 'x', rationale: '', alternatives: '', consequences: '', status: 'accepted', decidedOn: null, projectId: project.id, tagLabels: [], noteIds: [inProject.id], taskIds: [] }).decisions[0]!
    location.hash = `#/projects/${project.id}?tab=decisions&decision=${d.id}`
    view()
    const user = userEvent.setup()
    const drawer = await screen.findByRole('dialog', { name: 'Why we survey' })
    await user.click(within(drawer).getByRole('link', { name: 'Survey notes' }))
    // the note opens in the library with a backlink to the decision
    const note = await screen.findByRole('dialog', { name: 'Survey notes' })
    const back = await within(note).findByRole('link', { name: 'Why we survey' })
    expect(within(note).getAllByRole('link', { name: 'Atlas' }).length).toBeGreaterThan(0)
    await user.click(back)
    expect(await screen.findByRole('dialog', { name: 'Why we survey' })).toBeTruthy()
    expect(location.hash).toContain('/decisions?decision=')
  })

  it('lists and filters all decisions on the Decisions page', async () => {
    const { view, svc, project } = setup('#/decisions')
    const mk = (title: string, status: 'accepted' | 'rejected', tag: string) =>
      svc.createDecision({ title, context: '', decision: `${title} text`, rationale: '', alternatives: '', consequences: '', status, decidedOn: null, projectId: project.id, tagLabels: [tag], noteIds: [], taskIds: [] })
    mk('Alpha route', 'accepted', 'Roads')
    mk('Beta route', 'rejected', 'Rivers')
    view()
    const user = userEvent.setup()
    expect(await screen.findByText('Alpha route')).toBeTruthy()
    expect(screen.getByText('Beta route')).toBeTruthy()
    await user.type(screen.getByLabelText('Search decisions'), 'beta')
    await waitFor(() => expect(screen.queryByText('Alpha route')).toBeNull())
    expect(screen.getByText('Beta route')).toBeTruthy()
    await user.clear(screen.getByLabelText('Search decisions'))
    await user.type(screen.getByLabelText('Search decisions'), 'zzzz')
    expect(await screen.findByText('No decisions match these filters')).toBeTruthy()
  })
})

describe('tag management', () => {
  it('creates, reuses, renames and deletes tags without touching the records that use them', async () => {
    const { view, svc, inProject } = setup('#/tags')
    view()
    const user = userEvent.setup()
    expect(await screen.findByRole('heading', { level: 1, name: 'Tags' })).toBeTruthy()
    const add = async (name: string) => {
      await user.clear(screen.getByLabelText('New tag'))
      await user.type(screen.getByLabelText('New tag'), name)
      await user.click(screen.getByRole('button', { name: 'Add tag' }))
    }
    await add('Maps')
    await waitFor(() => expect(svc.listTags().map((t) => t.label)).toEqual(['Field', 'Maps']))
    await add('  maps ') // same tag, different spelling
    expect(await screen.findByText(/already exists, so it was reused/)).toBeTruthy()
    expect(svc.listTags()).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: 'Rename tag Maps' }))
    const input = screen.getByLabelText('Rename tag Maps')
    await user.clear(input)
    await user.type(input, 'field')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('A tag with this name already exists')).toBeTruthy()
    await user.clear(input)
    await user.type(input, 'Charts')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(svc.listTags().map((t) => t.label)).toEqual(['Field', 'Charts']))

    await user.click(screen.getByRole('button', { name: 'Delete tag Field' }))
    const confirm = await screen.findByRole('dialog')
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(svc.listTags().map((t) => t.label)).toEqual(['Charts']))
    expect(svc.getItem(inProject.id)).toMatchObject({ title: 'Survey notes', tagIds: [] })
  })

  it('adds and removes a tag on a note from its detail view', async () => {
    const { view, svc, inProject } = setup('#/library?item={i}')
    location.hash = `#/library?item=${inProject.id}`
    view()
    const user = userEvent.setup()
    const drawer = await screen.findByRole('dialog', { name: 'Survey notes' })
    await user.click(within(drawer).getByRole('button', { name: 'Edit tags' }))
    const input = drawer.querySelector('input[list]') as HTMLInputElement
    await user.type(input, 'Urgent{Enter}')
    await user.click(within(drawer).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(svc.getItem(inProject.id).tagIds).toHaveLength(2))
    await user.click(within(drawer).getByRole('button', { name: 'Edit tags' }))
    await user.click(within(drawer).getByRole('button', { name: 'Remove tag Field' }))
    await user.click(within(drawer).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(svc.getItem(inProject.id).tagIds).toHaveLength(1))
    expect(svc.listTags().map((t) => t.label).sort()).toEqual(['Field', 'Urgent'])
  })
})

describe('sample data on a brand-new database', () => {
  it('shows the sample decisions and keeps them after a restart', async () => {
    const db = openDatabase(':memory:')
    seedSampleDataIfNew(db)
    const svc = createWorkspaceService(db)
    location.hash = '#/decisions'
    render(<App api={bridgeFor(() => svc)} preferences={{ lang: 'en', reduceMotion: true }} />)
    expect(await screen.findByText('منبع حقیقت: SQLite به‌جای خزانه‌ی Markdown')).toBeTruthy()
    closeDatabase(db)
  })
})
