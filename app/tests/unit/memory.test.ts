// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import type { Database } from 'better-sqlite3'
import { closeDatabase, openDatabase } from '../../src/main/db/connection'
import { dataHandlers } from '../../src/main/ipc/data-handlers'
import { createWorkspaceService, DataError, type WorkspaceService } from '../../src/main/services/workspace-service'
import { IpcChannel } from '../../src/shared/ipc'
import { tempDir } from './helpers/db'

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((f) => f()))

/** A real database file with a clock that moves one minute per call, so event order is deterministic. */
function setup() {
  const tmp = tempDir()
  cleanups.push(tmp.cleanup)
  let tick = 0
  const clock = () => new Date(Date.UTC(2026, 9, 12, 8, 0, 0) + tick++ * 60_000)
  const db = openDatabase(tmp.file)
  const svc = createWorkspaceService(db, clock)
  cleanups.push(() => closeDatabase(db))
  const reopen = () => {
    closeDatabase(db)
    const db2 = openDatabase(tmp.file)
    cleanups.push(() => closeDatabase(db2))
    return { db: db2, svc: createWorkspaceService(db2, clock) }
  }
  return { db, svc, reopen, file: tmp.file }
}

const decisionInput = (over: Record<string, unknown> = {}) => ({
  title: 'Use SQLite',
  context: '',
  decision: 'Keep everything in one SQLite file.',
  rationale: '',
  alternatives: '',
  consequences: '',
  status: 'proposed',
  decidedOn: null,
  projectId: null,
  tagLabels: [],
  noteIds: [],
  taskIds: [],
  ...over
})
const note = (svc: WorkspaceService, title = 'A note', projectId: string | null = null) =>
  svc.createItem({ kind: 'note', title, body: '', url: '', tagLabels: [], projectId }).items[0]!
const task = (svc: WorkspaceService, title = 'A task', projectId: string | null = null) =>
  svc.createTask({ title, notes: '', status: 'todo', priority: 'medium', dueDate: null, projectId }).tasks[0]!
const project = (svc: WorkspaceService, name = 'Project') =>
  svc.createProject({ name, description: '', status: 'active' }).projects[0]!
const decision = (svc: WorkspaceService, over: Record<string, unknown> = {}) =>
  svc.createDecision(decisionInput(over)).decisions[0]!
const fails = (fn: () => unknown, code: string) => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(DataError)
    expect((e as DataError).code).toBe(code)
    return (e as DataError).fields
  }
  throw new Error('expected a DataError')
}
const count = (db: Database, sql: string, ...p: unknown[]) => (db.prepare(sql).get(...p) as { n: number }).n

describe('decision records', () => {
  it('creates, reads, updates and deletes a decision with all structured fields', () => {
    const { svc } = setup()
    const p = project(svc)
    const d = decision(svc, {
      title: ' Use SQLite ',
      context: 'Need transactions',
      rationale: 'Single file',
      alternatives: 'Markdown files',
      consequences: 'No hand editing',
      status: 'accepted',
      decidedOn: '2026-10-01',
      projectId: p.id,
      tagLabels: ['Storage']
    })
    expect(d).toMatchObject({
      title: 'Use SQLite',
      status: 'accepted',
      decidedOn: '2026-10-01',
      projectId: p.id,
      supersededById: null,
      noteIds: [],
      taskIds: [],
      origin: 'session'
    })
    expect(d.id).toMatch(/^dec-/)
    expect(d.tagIds).toHaveLength(1)
    expect(svc.getDecision(d.id)).toEqual(d)

    const updated = svc.updateDecision(d.id, { rationale: 'Backups are one file', decidedOn: null }).decisions[0]!
    expect(updated.rationale).toBe('Backups are one file')
    expect(updated.decidedOn).toBeNull()
    expect(updated.status).toBe('accepted')
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(d.updatedAt))

    const removed = svc.deleteDecision(d.id)
    expect(removed.removed).toEqual([{ type: 'decision', id: d.id }])
    fails(() => svc.getDecision(d.id), 'not_found')
    fails(() => svc.deleteDecision(d.id), 'not_found')
  })

  it('treats context, rationale, alternatives, consequences, date and project as optional', () => {
    const { svc } = setup()
    const d = decision(svc)
    expect(d).toMatchObject({ context: '', rationale: '', alternatives: '', consequences: '', decidedOn: null, projectId: null })
  })

  it('requires a title and a decision statement, and rejects bad input', () => {
    const { svc } = setup()
    expect(fails(() => svc.createDecision(decisionInput({ title: '   ' })), 'validation')).toHaveProperty('title')
    expect(fails(() => svc.createDecision(decisionInput({ decision: ' ' })), 'validation')).toHaveProperty('decision')
    fails(() => svc.createDecision(decisionInput({ status: 'superseded' })), 'validation')
    fails(() => svc.createDecision(decisionInput({ decidedOn: '2026-13-40' })), 'validation')
    fails(() => svc.createDecision(decisionInput({ surprise: true })), 'validation')
    fails(() => svc.createDecision(decisionInput({ projectId: 'proj-missing' })), 'not_found')
    fails(() => svc.createDecision(decisionInput({ noteIds: ['item-missing'] })), 'not_found')
    fails(() => svc.updateDecision(decision(svc).id, {}), 'validation')
    fails(() => svc.updateDecision(decision(svc).id, { status: 'accepted' }), 'validation')
  })

  it('does not leave a half-created decision when a link target is missing', () => {
    const { svc, db } = setup()
    const n = note(svc)
    fails(() => svc.createDecision(decisionInput({ noteIds: [n.id, 'item-missing'] })), 'not_found')
    expect(count(db, 'SELECT COUNT(*) AS n FROM decisions')).toBe(0)
    expect(count(db, "SELECT COUNT(*) AS n FROM activity_events WHERE kind = 'decision_created'")).toBe(0)
  })

  it('follows the status model and refuses invalid transitions', () => {
    const { svc } = setup()
    const d = decision(svc)
    expect(svc.setDecisionStatus({ id: d.id, status: 'accepted' }).decisions[0]!.status).toBe('accepted')
    fails(() => svc.setDecisionStatus({ id: d.id, status: 'proposed' }), 'conflict')
    expect(svc.setDecisionStatus({ id: d.id, status: 'rejected' }).decisions[0]!.status).toBe('rejected')
    expect(svc.setDecisionStatus({ id: d.id, status: 'proposed' }).decisions[0]!.status).toBe('proposed')
    fails(() => svc.setDecisionStatus({ id: d.id, status: 'superseded', supersededById: d.id }), 'conflict')
    // same status again is a no-op, with no new event
    const before = svc.loadWorkspace().activity.length
    expect(svc.setDecisionStatus({ id: d.id, status: 'proposed' }).activity).toEqual([])
    expect(svc.loadWorkspace().activity.length).toBe(before)
    fails(() => svc.setDecisionStatus({ id: d.id, status: 'accepted', supersededById: d.id }), 'validation')
    fails(() => svc.setDecisionStatus({ id: 'dec-missing', status: 'accepted' }), 'not_found')
  })

  it('supersedes a decision with a replacement and keeps the original', () => {
    const { svc, db } = setup()
    const n = note(svc)
    const old = decision(svc, { title: 'Old', status: 'accepted', noteIds: [n.id] })
    const next = decision(svc, { title: 'New', status: 'accepted' })
    fails(() => svc.setDecisionStatus({ id: old.id, status: 'superseded' }), 'validation')
    fails(() => svc.setDecisionStatus({ id: old.id, status: 'superseded', supersededById: 'dec-missing' }), 'not_found')
    const done = svc.setDecisionStatus({ id: old.id, status: 'superseded', supersededById: next.id })
    expect(done.decisions[0]).toMatchObject({ id: old.id, status: 'superseded', supersededById: next.id, title: 'Old', noteIds: [n.id] })
    expect(done.activity[0]).toMatchObject({
      kind: 'decision_superseded',
      ref: { type: 'decision', id: old.id },
      meta: { related: { type: 'decision', id: next.id, title: 'New' } }
    })
    // loop: the replacement cannot be replaced by the decision it replaced
    fails(() => svc.setDecisionStatus({ id: next.id, status: 'superseded', supersededById: old.id }), 'conflict')
    // the history survives when the replacement is deleted: still superseded, pointer cleared
    const gone = svc.deleteDecision(next.id)
    expect(gone.decisions[0]).toMatchObject({ id: old.id, status: 'superseded', supersededById: null })
    expect(count(db, 'SELECT COUNT(*) AS n FROM decisions WHERE id = ?', old.id)).toBe(1)
    // a superseded decision can be restored
    expect(svc.setDecisionStatus({ id: old.id, status: 'accepted' }).decisions[0]).toMatchObject({ status: 'accepted', supersededById: null })
  })

  it('does not allow a rejected decision to replace another', () => {
    const { svc } = setup()
    const a = decision(svc, { status: 'accepted' })
    const b = decision(svc, { title: 'B', status: 'rejected' })
    fails(() => svc.setDecisionStatus({ id: a.id, status: 'superseded', supersededById: b.id }), 'validation')
  })
})

describe('knowledge relationships', () => {
  it('links and unlinks notes and tasks without deleting either record', () => {
    const { svc, db } = setup()
    const d = decision(svc)
    const n = note(svc)
    const t = task(svc)
    const linked = svc.linkDecision({ decisionId: d.id, targetType: 'item', targetId: n.id })
    expect(linked.decisions[0]!.noteIds).toEqual([n.id])
    expect(svc.linkDecision({ decisionId: d.id, targetType: 'task', targetId: t.id }).decisions[0]!.taskIds).toEqual([t.id])
    // linking twice is harmless and records nothing new
    expect(svc.linkDecision({ decisionId: d.id, targetType: 'item', targetId: n.id }).activity).toEqual([])
    expect(count(db, 'SELECT COUNT(*) AS n FROM decision_items')).toBe(1)

    expect(svc.unlinkDecision({ decisionId: d.id, targetType: 'item', targetId: n.id }).decisions[0]!.noteIds).toEqual([])
    svc.unlinkDecision({ decisionId: d.id, targetType: 'task', targetId: t.id })
    expect(svc.getItem(n.id).title).toBe('A note')
    expect(svc.getTask(t.id).title).toBe('A task')
    expect(svc.getDecision(d.id).title).toBe('Use SQLite')
    expect(svc.unlinkDecision({ decisionId: d.id, targetType: 'item', targetId: n.id }).activity).toEqual([])
  })

  it('rejects links to missing or wrong records', () => {
    const { svc } = setup()
    const d = decision(svc)
    const t = task(svc)
    fails(() => svc.linkDecision({ decisionId: d.id, targetType: 'item', targetId: 'item-missing' }), 'not_found')
    fails(() => svc.linkDecision({ decisionId: d.id, targetType: 'item', targetId: t.id }), 'not_found') // a task id is not a note
    fails(() => svc.linkDecision({ decisionId: 'dec-missing', targetType: 'task', targetId: t.id }), 'not_found')
    fails(() => svc.linkDecision({ decisionId: d.id, targetType: 'project', targetId: t.id }), 'validation')
    fails(() => svc.linkDecision({ decisionId: d.id, targetType: 'task', targetId: 'not an id' }), 'validation')
  })

  it('removes only the link when a linked note or task is deleted, and reports the changed decision', () => {
    const { svc } = setup()
    const n = note(svc)
    const t = task(svc)
    const d = decision(svc, { noteIds: [n.id], taskIds: [t.id] })
    const afterNote = svc.deleteItem(n.id)
    expect(afterNote.decisions[0]).toMatchObject({ id: d.id, noteIds: [], taskIds: [t.id] })
    const afterTask = svc.deleteTask(t.id)
    expect(afterTask.decisions[0]).toMatchObject({ id: d.id, noteIds: [], taskIds: [] })
    expect(svc.getDecision(d.id).title).toBe('Use SQLite')
  })

  it('associates notes, tasks and decisions with a project, and keeps them when the project is deleted', () => {
    const { svc } = setup()
    const p = project(svc)
    const n = note(svc, 'N', p.id)
    const t = task(svc, 'T', p.id)
    const d = decision(svc, { projectId: p.id })
    expect([n.projectId, t.projectId, d.projectId]).toEqual([p.id, p.id, p.id])
    const del = svc.deleteProject(p.id)
    expect(del.items[0]).toMatchObject({ id: n.id, projectId: null })
    expect(del.tasks[0]).toMatchObject({ id: t.id, projectId: null })
    expect(del.decisions[0]).toMatchObject({ id: d.id, projectId: null })
    expect(svc.getDecision(d.id).projectId).toBeNull()
  })

  it('links and unlinks a note to a project without deleting the note', () => {
    const { svc } = setup()
    const p = project(svc)
    const n = note(svc)
    expect(svc.updateItem(n.id, { projectId: p.id }).items[0]!.projectId).toBe(p.id)
    const un = svc.updateItem(n.id, { projectId: null })
    expect(un.items[0]).toMatchObject({ id: n.id, projectId: null })
    expect(svc.getItem(n.id).title).toBe('A note')
    fails(() => svc.updateItem(n.id, { projectId: 'proj-missing' }), 'not_found')
  })

  it('keeps relationships after the database is closed and reopened', () => {
    const { svc, reopen } = setup()
    const p = project(svc)
    const n = note(svc, 'N', p.id)
    const t = task(svc, 'T', p.id)
    const a = decision(svc, { projectId: p.id, status: 'accepted', noteIds: [n.id], taskIds: [t.id], tagLabels: ['Storage'] })
    const b = decision(svc, { title: 'B', status: 'accepted' })
    svc.setDecisionStatus({ id: a.id, status: 'superseded', supersededById: b.id })
    const before = svc.getDecision(a.id)
    const { svc: again } = reopen()
    expect(again.getDecision(a.id)).toEqual(before)
    expect(again.getDecision(a.id)).toMatchObject({ noteIds: [n.id], taskIds: [t.id], projectId: p.id, supersededById: b.id })
    expect(again.loadWorkspace().decisions.map((d) => d.id).sort()).toEqual([a.id, b.id].sort())
  })

  it('enforces integrity in the database itself, not only in the service', () => {
    const { svc, db } = setup()
    const d = decision(svc)
    expect(() => db.prepare("INSERT INTO decision_items (decision_id, item_id, created_at) VALUES (?, 'item-nope', 'x')").run(d.id)).toThrow(/FOREIGN KEY/)
    expect(() => db.prepare("UPDATE decisions SET status = 'maybe' WHERE id = ?").run(d.id)).toThrow(/CHECK/)
    expect(() => db.prepare('UPDATE decisions SET superseded_by = id, status = ? WHERE id = ?').run('superseded', d.id)).toThrow(/CHECK/)
    expect(() => db.prepare("UPDATE decisions SET decision = '  ' WHERE id = ?").run(d.id)).toThrow(/CHECK/)
  })
})

describe('tags', () => {
  it('reuses an existing tag whatever its case, spacing or Persian letter variant', () => {
    const { svc } = setup()
    const a = svc.createTag({ label: 'Design' }).tags[0]!
    expect(svc.createTag({ label: '  design ' }).tags[0]!.id).toBe(a.id)
    expect(svc.createTag({ label: '#DESIGN' }).tags[0]!.id).toBe(a.id)
    const fa = svc.createTag({ label: 'كتاب' }).tags[0]! // Arabic kaf + yeh
    expect(svc.createTag({ label: 'کتاب' }).tags[0]!.id).toBe(fa.id)
    expect(svc.listTags()).toHaveLength(2)
    fails(() => svc.createTag({ label: '   ' }), 'validation')
    fails(() => svc.createTag({ label: 'x'.repeat(41) }), 'validation')
  })

  it('applies tags to notes and decisions, removes them again, and filters by tag', () => {
    const { svc } = setup()
    const n = svc.createItem({ kind: 'note', title: 'N', body: '', url: '', tagLabels: ['Alpha', 'alpha', 'Beta'], projectId: null }).items[0]!
    expect(n.tagIds).toHaveLength(2) // duplicate collapsed
    const d = decision(svc, { tagLabels: ['ALPHA'] })
    const alpha = svc.listTags().find((t) => t.label === 'Alpha')!
    expect(d.tagIds).toEqual([alpha.id])
    expect(svc.searchItems({ text: '', tagId: alpha.id }).map((i) => i.id)).toEqual([n.id])
    expect(svc.updateItem(n.id, { tagLabels: ['Beta'] }).items[0]!.tagIds).not.toContain(alpha.id)
    expect(svc.searchItems({ text: '', tagId: alpha.id })).toEqual([])
    expect(svc.updateDecision(d.id, { tagLabels: [] }).decisions[0]!.tagIds).toEqual([])
    expect(svc.listTags().some((t) => t.id === alpha.id)).toBe(true) // removing from records keeps the tag
  })

  it('renames a tag everywhere and refuses a name that is already taken', () => {
    const { svc } = setup()
    const n = svc.createItem({ kind: 'note', title: 'N', body: '', url: '', tagLabels: ['Old', 'Other'], projectId: null }).items[0]!
    const [old, other] = svc.listTags()
    expect(svc.renameTag({ id: old!.id, label: 'Fresh' }).tags[0]).toEqual({ id: old!.id, label: 'Fresh' })
    expect(svc.loadWorkspace().tags.find((t) => t.id === old!.id)?.label).toBe('Fresh')
    expect(svc.getItem(n.id).tagIds).toContain(old!.id)
    expect(fails(() => svc.renameTag({ id: old!.id, label: ' other ' }), 'conflict')).toHaveProperty('label')
    expect(svc.renameTag({ id: other!.id, label: 'OTHER' }).tags[0]!.label).toBe('OTHER') // changing own case is fine
    fails(() => svc.renameTag({ id: 'tag-missing', label: 'x' }), 'not_found')
  })

  it('deleting a tag keeps every note and decision that used it', () => {
    const { svc, db } = setup()
    const n = svc.createItem({ kind: 'note', title: 'N', body: '', url: '', tagLabels: ['Gone'], projectId: null }).items[0]!
    const d = decision(svc, { tagLabels: ['Gone'] })
    const tag = svc.listTags()[0]!
    const del = svc.deleteTag(tag.id)
    expect(del.removed).toEqual([{ type: 'tag', id: tag.id }])
    expect(del.items[0]).toMatchObject({ id: n.id, tagIds: [] })
    expect(del.decisions[0]).toMatchObject({ id: d.id, tagIds: [] })
    expect(svc.getItem(n.id).title).toBe('N')
    expect(svc.getDecision(d.id).title).toBe('Use SQLite')
    expect(count(db, 'SELECT COUNT(*) AS n FROM item_tags') + count(db, 'SELECT COUNT(*) AS n FROM decision_tags')).toBe(0)
    fails(() => svc.deleteTag(tag.id), 'not_found')
  })
})

describe('project activity timeline', () => {
  it('records the expected events, tied to the right records and projects', () => {
    const { svc } = setup()
    const p = project(svc, 'Alpha')
    const other = project(svc, 'Beta')
    const n = note(svc, 'N', p.id)
    const t = task(svc, 'T', p.id)
    svc.setTaskStatus(t.id, 'done')
    svc.setTaskStatus(t.id, 'todo')
    const d = decision(svc, { projectId: p.id })
    svc.setDecisionStatus({ id: d.id, status: 'accepted' })
    svc.linkDecision({ decisionId: d.id, targetType: 'item', targetId: n.id })
    svc.unlinkDecision({ decisionId: d.id, targetType: 'item', targetId: n.id })
    svc.updateItem(n.id, { title: 'N2' })
    svc.updateProject(p.id, { description: 'changed' })
    note(svc, 'elsewhere', other.id)

    const events = svc.listProjectActivity({ projectId: p.id, limit: 50 })
    expect(events.map((e) => e.kind)).toEqual([
      'project_updated',
      'item_updated',
      'decision_link_removed',
      'decision_link_added',
      'decision_accepted',
      'decision_created',
      'task_reopened',
      'task_completed',
      'task_created',
      'item_captured',
      'project_created'
    ])
    expect(events.every((e) => e.projectId === p.id)).toBe(true)
    const linkAdded = events.find((e) => e.kind === 'decision_link_added')!
    expect(linkAdded.ref).toEqual({ type: 'decision', id: d.id })
    expect(linkAdded.meta?.related).toEqual({ type: 'item', id: n.id, title: 'N' })
    expect(events.find((e) => e.kind === 'task_completed')!.ref).toEqual({ type: 'task', id: t.id })
    expect(svc.listProjectActivity({ projectId: other.id }).map((e) => e.kind)).toEqual(['item_captured', 'project_created'])
  })

  it('records linking and unlinking a note and moving a task between projects', () => {
    const { svc } = setup()
    const a = project(svc, 'A')
    const b = project(svc, 'B')
    const n = note(svc)
    svc.updateItem(n.id, { projectId: a.id })
    svc.updateItem(n.id, { projectId: b.id })
    svc.updateItem(n.id, { projectId: null })
    const t = task(svc, 'T', a.id)
    svc.updateTask(t.id, { projectId: b.id })
    const kinds = (id: string) => svc.listProjectActivity({ projectId: id }).map((e) => e.kind)
    expect(kinds(a.id)).toEqual(['task_project_unlinked', 'task_created', 'item_project_unlinked', 'item_project_linked', 'project_created'])
    expect(kinds(b.id)).toEqual(['task_project_linked', 'item_project_unlinked', 'item_project_linked', 'project_created'])
    const unlinked = svc.listProjectActivity({ projectId: a.id }).find((e) => e.kind === 'item_project_unlinked')!
    expect(unlinked.meta?.related).toMatchObject({ type: 'project', id: a.id, title: 'A' })
  })

  it('does not add noise when nothing actually changed', () => {
    const { svc } = setup()
    const p = project(svc)
    const t = task(svc, 'T', p.id)
    const d = decision(svc, { projectId: p.id })
    const total = () => svc.listProjectActivity({ projectId: p.id, limit: 100 }).length
    const before = total()
    svc.updateProject(p.id, { name: p.name })
    svc.updateTask(t.id, { title: t.title, priority: t.priority })
    svc.updateDecision(d.id, { title: d.title })
    expect(total()).toBe(before)
  })

  it('orders newest first, pages with a limit, and keeps events after a restart', () => {
    const { svc, reopen } = setup()
    const p = project(svc)
    for (let i = 0; i < 7; i++) note(svc, `Note ${i}`, p.id)
    const first = svc.listProjectActivity({ projectId: p.id, limit: 3 })
    expect(first.map((e) => e.subject)).toEqual(['Note 6', 'Note 5', 'Note 4'])
    const next = svc.listProjectActivity({ projectId: p.id, limit: 3, before: first.at(-1)!.at })
    expect(next.map((e) => e.subject)).toEqual(['Note 3', 'Note 2', 'Note 1'])
    const all = svc.listProjectActivity({ projectId: p.id, limit: 100 })
    expect(all).toHaveLength(8)
    expect(all.map((e) => e.at)).toEqual([...all.map((e) => e.at)].sort().reverse())
    fails(() => svc.listProjectActivity({ projectId: p.id, limit: 101 }), 'validation')
    const { svc: again } = reopen()
    expect(again.listProjectActivity({ projectId: p.id, limit: 100 })).toEqual(all)
  })

  it('removes a deleted record\'s own events and leaves the rest of the timeline intact', () => {
    const { svc } = setup()
    const p = project(svc)
    const n = note(svc, 'Doomed', p.id)
    const d = decision(svc, { projectId: p.id, noteIds: [n.id] })
    svc.deleteItem(n.id)
    svc.deleteDecision(d.id)
    const events = svc.listProjectActivity({ projectId: p.id })
    expect(events.map((e) => e.kind)).toEqual(['project_created'])
    expect(svc.listProjectActivity({ projectId: 'proj-never-existed' })).toEqual([])
  })

  it('keeps a link event readable after the linked record is deleted', () => {
    const { svc } = setup()
    const p = project(svc)
    const t = task(svc, 'Short-lived')
    const d = decision(svc, { projectId: p.id })
    svc.linkDecision({ decisionId: d.id, targetType: 'task', targetId: t.id })
    svc.deleteTask(t.id)
    const ev = svc.listProjectActivity({ projectId: p.id }).find((e) => e.kind === 'decision_link_added')!
    expect(ev.meta?.related?.title).toBe('Short-lived') // title is stored with the event; the UI shows it unlinked
  })

  it('writes the record and its event together or not at all', () => {
    const { svc, db } = setup()
    const p = project(svc)
    db.exec(`CREATE TRIGGER fail_event BEFORE INSERT ON activity_events WHEN NEW.kind = 'decision_created'
             BEGIN SELECT RAISE(ABORT, 'no events today'); END`)
    expect(() => svc.createDecision(decisionInput({ projectId: p.id }))).toThrow()
    expect(count(db, 'SELECT COUNT(*) AS n FROM decisions')).toBe(0)
    expect(count(db, 'SELECT COUNT(*) AS n FROM decision_tags')).toBe(0)
  })

  it('survives a damaged metadata value', () => {
    const { svc, db } = setup()
    const p = project(svc)
    const d = decision(svc, { projectId: p.id })
    db.prepare("UPDATE activity_events SET meta = '{not json' WHERE ref_id = ?").run(d.id)
    const ev = svc.listProjectActivity({ projectId: p.id }).find((e) => e.ref.id === d.id)!
    expect(ev.meta).toBeUndefined()
  })
})

describe('narrow, validated IPC surface', () => {
  it('exposes named channels only, none that accept SQL or table names', () => {
    const { svc } = setup()
    const handlers = dataHandlers(() => svc)
    for (const ch of Object.values(IpcChannel).filter((c) => c.startsWith('data:'))) expect(handlers[ch], ch).toBeTypeOf('function')
    expect(Object.keys(handlers).some((k) => /sql|query|exec|raw|table/i.test(k))).toBe(false)
  })

  it('rejects malformed payloads before they reach the database', () => {
    const { svc, db } = setup()
    const h = dataHandlers(() => svc)
    const call = (ch: string, ...a: unknown[]) => () => h[ch]!(...a)
    expect(call(IpcChannel.createDecision, 'DROP TABLE decisions')).toThrow(DataError)
    expect(call(IpcChannel.createDecision, null)).toThrow(DataError)
    expect(call(IpcChannel.deleteDecision, "dec-x'; DROP TABLE decisions;--")).toThrow(DataError)
    expect(call(IpcChannel.linkDecision, { decisionId: 'dec-a', targetType: 'item; --', targetId: 'item-a' })).toThrow(DataError)
    expect(call(IpcChannel.listProjectActivity, { projectId: 'proj-a', limit: -1 })).toThrow(DataError)
    expect(call(IpcChannel.renameTag, { id: 'tag-a', label: 'x', extra: 1 })).toThrow(DataError)
    expect(count(db, "SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'decisions'")).toBe(1)
  })

  it('is safe against SQL-looking text in titles', () => {
    const { svc } = setup()
    const d = decision(svc, { title: "Robert'); DROP TABLE decisions;--", decision: "x' OR '1'='1" })
    expect(svc.getDecision(d.id).title).toContain('DROP TABLE')
    expect(svc.loadWorkspace().decisions).toHaveLength(1)
  })
})
