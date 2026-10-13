// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'better-sqlite3'
import { openDatabase } from '../../src/main/db/connection'
import { createWorkspaceService, DataError, type WorkspaceService } from '../../src/main/services/workspace-service'

let db: Database
let svc: WorkspaceService
let clock = 0
beforeEach(() => {
  db = openDatabase(':memory:')
  clock = Date.parse('2026-10-12T10:00:00Z')
  svc = createWorkspaceService(db, () => new Date((clock += 1000)))
})

const note = (over: Record<string, unknown> = {}) => ({ kind: 'note', title: 'A note', body: '', url: '', tagLabels: [], projectId: null, ...over })
const task = (over: Record<string, unknown> = {}) => ({ title: 'A task', notes: '', status: 'todo', priority: 'medium', dueDate: null, projectId: null, ...over })
const fails = (fn: () => unknown, code: string) => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(DataError)
    expect((e as DataError).code).toBe(code)
    return e as DataError
  }
  throw new Error('expected failure')
}

describe('notes', () => {
  it('creates, retrieves, updates and deletes', () => {
    const created = svc.createItem(note({ title: '  Idea one  ', kind: 'idea' }))
    const item = created.items[0]!
    expect(item.title).toBe('Idea one')
    expect(created.activity[0]?.kind).toBe('item_captured')
    expect(svc.getItem(item.id)).toEqual(item)

    const updated = svc.updateItem(item.id, { title: 'Idea two', body: 'more' }).items[0]!
    expect(updated).toMatchObject({ title: 'Idea two', body: 'more', kind: 'idea' })
    expect(updated.updatedAt > item.updatedAt).toBe(true)

    expect(svc.deleteItem(item.id).removed).toEqual([{ type: 'item', id: item.id }])
    fails(() => svc.getItem(item.id), 'not_found')
    expect(svc.loadWorkspace().activity.some((a) => a.ref.id === item.id)).toBe(false)
  })

  it('reuses tags by normalised label and removes links without deleting tags', () => {
    const a = svc.createItem(note({ tagLabels: ['SQLite', 'كتاب'] }))
    expect(a.tags.map((t) => t.label)).toEqual(['SQLite', 'كتاب'])
    const b = svc.createItem(note({ tagLabels: ['sqlite', 'کتاب'] }))
    expect(b.tags).toEqual([])
    expect(b.items[0]!.tagIds).toEqual(a.items[0]!.tagIds)

    svc.updateItem(a.items[0]!.id, { tagLabels: [] })
    expect(svc.getItem(a.items[0]!.id).tagIds).toEqual([])
    expect(svc.listTags()).toHaveLength(2)
    expect(svc.getItem(b.items[0]!.id).tagIds).toHaveLength(2)
    svc.deleteItem(b.items[0]!.id)
    expect(svc.listTags()).toHaveLength(2)
  })

  it('links to projects and searches case-insensitively with filters', () => {
    const p = svc.createProject({ name: 'P', description: '', status: 'active' }).projects[0]!
    svc.createItem(note({ title: 'SQLite WAL mode', projectId: p.id, tagLabels: ['db'] }))
    svc.createItem(note({ title: 'Persian يادداشت', kind: 'idea' }))
    svc.createItem(note({ title: 'Other', body: '100% done_ok' }))
    expect(svc.searchItems({ text: 'sqlite wal' }).map((i) => i.title)).toEqual(['SQLite WAL mode'])
    expect(svc.searchItems({ text: 'یادداشت' }).map((i) => i.title)).toEqual(['Persian يادداشت'])
    expect(svc.searchItems({ text: '', kind: 'idea' })).toHaveLength(1)
    expect(svc.searchItems({ text: '', projectId: p.id })).toHaveLength(1)
    const tagId = svc.listTags()[0]!.id
    expect(svc.searchItems({ text: '', tagId })).toHaveLength(1)
    // LIKE wildcards in user text are literal.
    expect(svc.searchItems({ text: '%' }).map((i) => i.title)).toEqual(['Other'])
    expect(svc.searchItems({ text: '_' }).map((i) => i.title)).toEqual(['Other'])
    expect(svc.searchItems({ text: "' OR 1=1 --" })).toEqual([])
    expect(svc.searchItems({ text: '', limit: 2 })).toHaveLength(2)
  })

  it('rejects invalid input and changes nothing', () => {
    fails(() => svc.createItem(note({ title: '   ' })), 'validation')
    fails(() => svc.createItem(note({ title: 'x'.repeat(141) })), 'validation')
    fails(() => svc.createItem(note({ kind: 'pdf' })), 'validation')
    const e = fails(() => svc.createItem(note({ kind: 'link', url: 'javascript:alert(1)' })), 'validation')
    expect(e.fields).toHaveProperty('url')
    fails(() => svc.createItem(note({ sql: 'DROP TABLE items' })), 'validation')
    fails(() => svc.createItem(note({ projectId: 'proj-missing' })), 'not_found')
    fails(() => svc.getItem('../../etc/passwd'), 'validation')
    expect(svc.loadWorkspace().items).toEqual([])
    expect(svc.listTags()).toEqual([])
  })
})

describe('projects', () => {
  it('creates, retrieves, updates and deletes', () => {
    const p = svc.createProject({ name: 'Thesis', description: ' d ', status: 'planning' }).projects[0]!
    expect(svc.getProject(p.id)).toMatchObject({ name: 'Thesis', description: 'd', status: 'planning' })
    expect(svc.updateProject(p.id, { status: 'active' }).projects[0]).toMatchObject({ name: 'Thesis', status: 'active' })
    fails(() => svc.updateProject(p.id, { status: 'archived' }), 'validation')
    fails(() => svc.updateProject(p.id, {}), 'validation')
    svc.deleteProject(p.id)
    fails(() => svc.getProject(p.id), 'not_found')
    fails(() => svc.deleteProject(p.id), 'not_found')
  })

  it('keeps notes and tasks when their project is deleted, unassigning them', () => {
    const p = svc.createProject({ name: 'P', description: '', status: 'active' }).projects[0]!
    const i = svc.createItem(note({ projectId: p.id })).items[0]!
    const t = svc.createTask(task({ projectId: p.id })).tasks[0]!
    const other = svc.createTask(task()).tasks[0]!
    const changes = svc.deleteProject(p.id)
    expect(changes.items.map((x) => [x.id, x.projectId])).toEqual([[i.id, null]])
    expect(changes.tasks.map((x) => [x.id, x.projectId])).toEqual([[t.id, null]])
    expect(svc.getItem(i.id).projectId).toBeNull()
    expect(svc.getTask(t.id).projectId).toBeNull()
    expect(svc.getTask(other.id)).toEqual(other)
  })

  it('touches the project when work is added to it', () => {
    const p = svc.createProject({ name: 'P', description: '', status: 'active' }).projects[0]!
    const changes = svc.createTask(task({ projectId: p.id }))
    expect(changes.projects[0]!.updatedAt > p.updatedAt).toBe(true)
  })
})

describe('tasks', () => {
  it('creates, retrieves, updates status and priority, completes, reopens and deletes', () => {
    const t = svc.createTask(task({ title: 'Write', dueDate: '2026-10-20' })).tasks[0]!
    expect(svc.getTask(t.id)).toEqual(t)
    expect(t.completedAt).toBeNull()

    const p = svc.updateTask(t.id, { priority: 'high', status: 'in_progress' }).tasks[0]!
    expect(p).toMatchObject({ priority: 'high', status: 'in_progress', completedAt: null })

    const done = svc.completeTask(t.id)
    expect(done.tasks[0]!.completedAt).not.toBeNull()
    expect(done.activity[0]!.kind).toBe('task_completed')
    const reopened = svc.setTaskStatus(t.id, 'todo')
    expect(reopened.tasks[0]!.completedAt).toBeNull()
    expect(reopened.activity[0]!.kind).toBe('task_reopened')
    expect(svc.setTaskStatus(t.id, 'todo').activity).toEqual([])

    svc.deleteTask(t.id)
    fails(() => svc.getTask(t.id), 'not_found')
  })

  it('a task created as done gets a completion time', () => {
    expect(svc.createTask(task({ status: 'done' })).tasks[0]!.completedAt).not.toBeNull()
  })

  it('filters by status, priority and project', () => {
    const p = svc.createProject({ name: 'P', description: '', status: 'active' }).projects[0]!
    svc.createTask(task({ title: 'a', priority: 'high', projectId: p.id }))
    svc.createTask(task({ title: 'b', status: 'done' }))
    svc.createTask(task({ title: 'c', priority: 'low' }))
    expect(svc.listTasks({ status: 'done' }).map((t) => t.title)).toEqual(['b'])
    expect(svc.listTasks({ priority: 'high' }).map((t) => t.title)).toEqual(['a'])
    expect(svc.listTasks({ projectId: p.id }).map((t) => t.title)).toEqual(['a'])
    expect(svc.listTasks({})).toHaveLength(3)
  })

  it('rejects invalid status, priority, date and ids', () => {
    const t = svc.createTask(task()).tasks[0]!
    fails(() => svc.setTaskStatus(t.id, 'finished'), 'validation')
    fails(() => svc.updateTask(t.id, { priority: 'urgent' }), 'validation')
    fails(() => svc.createTask(task({ dueDate: '2026-02-30' })), 'validation')
    fails(() => svc.setTaskStatus("x'; DROP TABLE tasks; --", 'done'), 'validation')
    fails(() => svc.setTaskStatus('task-missing', 'done'), 'not_found')
    expect(svc.getTask(t.id)).toEqual(t)
  })
})

describe('transactions', () => {
  it('rolls back every step of a write that fails midway', () => {
    // Make the activity insert (the last step of createItem) fail.
    db.exec(`CREATE TRIGGER fail_activity BEFORE INSERT ON activity_events BEGIN SELECT RAISE(ABORT, 'boom'); END`)
    expect(() => svc.createItem(note({ tagLabels: ['new-tag'] }))).toThrow(/boom/)
    expect(svc.loadWorkspace().items).toEqual([])
    expect(svc.listTags()).toEqual([])
  })
})

describe('preferences', () => {
  it('stores allowlisted keys only', () => {
    svc.setPreferences({ lang: 'en', sidebarCollapsed: null })
    expect(svc.getPreferences()).toEqual({ lang: 'en', sidebarCollapsed: null })
    fails(() => svc.setPreferences({ apiKey: 'sk-secret' }), 'validation')
    fails(() => svc.setPreferences({ lang: 'de' }), 'validation')
    db.prepare("INSERT INTO preferences VALUES ('calendar', '\"martian\"')").run()
    expect(svc.getPreferences()).toEqual({ lang: 'en', sidebarCollapsed: null })
  })
})
