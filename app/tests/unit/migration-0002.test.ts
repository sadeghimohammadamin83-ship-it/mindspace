// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { closeDatabase, openDatabase } from '../../src/main/db/connection'
import { MIGRATIONS, currentSchemaVersion, runMigrations } from '../../src/main/db/migrations'
import { seedSampleDataIfNew } from '../../src/main/db/seed'
import { createWorkspaceService } from '../../src/main/services/workspace-service'
import { tempDir } from './helpers/db'

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((f) => f()))

/** A database exactly as Phase 2 left it: only migration 0001 applied, with realistic user data. */
function phase2Database() {
  const tmp = tempDir()
  cleanups.push(tmp.cleanup)
  const db = new Database(tmp.file)
  db.pragma('foreign_keys = ON')
  runMigrations(db, [MIGRATIONS[0]!])
  const at = '2026-10-10T09:00:00.000Z'
  db.exec(`
    INSERT INTO projects (id, name, description, status, origin, created_at, updated_at)
      VALUES ('proj-a', 'Alpha', 'first', 'active', 'user', '${at}', '${at}'),
             ('proj-b', 'Beta', '', 'planning', 'user', '${at}', '${at}');
    INSERT INTO tags (id, label, label_key, created_at) VALUES ('tag-1', 'Storage', 'storage', '${at}'), ('tag-2', 'Idle', 'idle', '${at}');
    INSERT INTO items (id, kind, title, body, url, project_id, search_text, origin, created_at, updated_at)
      VALUES ('item-1', 'note', 'Kept note', 'body', NULL, 'proj-a', 'kept note body', 'user', '${at}', '${at}'),
             ('item-2', 'decision', 'Legacy decision note', 'text', NULL, NULL, 'x', 'sample', '${at}', '${at}');
    INSERT INTO item_tags (item_id, tag_id) VALUES ('item-1', 'tag-1');
    INSERT INTO tasks (id, title, notes, status, priority, due_date, project_id, origin, created_at, updated_at, completed_at)
      VALUES ('task-1', 'Kept task', '', 'done', 'high', '2026-10-11', 'proj-a', 'user', '${at}', '${at}', '${at}'),
             ('task-2', 'Loose task', '', 'todo', 'low', NULL, NULL, 'user', '${at}', '${at}', NULL);
    INSERT INTO activity_events (id, kind, subject, ref_type, ref_id, origin, at) VALUES
      ('act-p', 'project_created', 'Alpha', 'project', 'proj-a', 'user', '2026-10-10T09:00:00.000Z'),
      ('act-i', 'item_captured', 'Kept note', 'item', 'item-1', 'user', '2026-10-10T09:01:00.000Z'),
      ('act-t', 'task_completed', 'Kept task', 'task', 'task-1', 'user', '2026-10-10T09:02:00.000Z'),
      ('act-l', 'task_created', 'Loose task', 'task', 'task-2', 'user', '2026-10-10T09:03:00.000Z'),
      ('act-x', 'item_captured', 'Deleted since', 'item', 'item-gone', 'user', '2026-10-10T09:04:00.000Z');
    INSERT INTO preferences (key, value) VALUES ('lang', '"en"');
    INSERT INTO app_meta (key, value) VALUES ('sample_seeded', 'skipped-existing-data');
  `)
  db.close()
  return tmp
}

describe('upgrading a Phase 2 database to the Phase 3 schema', () => {
  it('applies only the new migration and keeps every stored row', () => {
    const tmp = phase2Database()
    const db = openDatabase(tmp.file)
    cleanups.push(() => closeDatabase(db))
    expect(currentSchemaVersion(db)).toBe(MIGRATIONS.at(-1)!.version)
    expect((db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[]).map((r) => r.version)).toEqual(
      MIGRATIONS.map((m) => m.version)
    )
    const n = (t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n
    expect([n('projects'), n('items'), n('tags'), n('item_tags'), n('tasks'), n('preferences'), n('activity_events')]).toEqual([2, 2, 2, 1, 2, 1, 5])
    expect(db.prepare("SELECT title, project_id FROM items WHERE id = 'item-1'").get()).toEqual({ title: 'Kept note', project_id: 'proj-a' })
    expect(db.prepare("SELECT label FROM tags WHERE id = 'tag-1'").get()).toEqual({ label: 'Storage' })
    expect(db.prepare("SELECT status, completed_at FROM tasks WHERE id = 'task-1'").get()).toMatchObject({ status: 'done' })
    expect(db.prepare("SELECT kind FROM items WHERE id = 'item-2'").get()).toEqual({ kind: 'decision' }) // legacy note kind is untouched
    expect(n('decisions')).toBe(0)
  })

  it('back-fills the project of existing activity events and keeps their order and text', () => {
    const tmp = phase2Database()
    const db = openDatabase(tmp.file)
    cleanups.push(() => closeDatabase(db))
    const rows = db.prepare('SELECT id, kind, subject, ref_type, project_id, meta, at FROM activity_events ORDER BY at').all()
    expect(rows).toEqual([
      { id: 'act-p', kind: 'project_created', subject: 'Alpha', ref_type: 'project', project_id: 'proj-a', meta: null, at: '2026-10-10T09:00:00.000Z' },
      { id: 'act-i', kind: 'item_captured', subject: 'Kept note', ref_type: 'item', project_id: 'proj-a', meta: null, at: '2026-10-10T09:01:00.000Z' },
      { id: 'act-t', kind: 'task_completed', subject: 'Kept task', ref_type: 'task', project_id: 'proj-a', meta: null, at: '2026-10-10T09:02:00.000Z' },
      { id: 'act-l', kind: 'task_created', subject: 'Loose task', ref_type: 'task', project_id: null, meta: null, at: '2026-10-10T09:03:00.000Z' },
      { id: 'act-x', kind: 'item_captured', subject: 'Deleted since', ref_type: 'item', project_id: null, meta: null, at: '2026-10-10T09:04:00.000Z' }
    ])
    const svc = createWorkspaceService(db)
    expect(svc.listProjectActivity({ projectId: 'proj-a' }).map((e) => e.id)).toEqual(['act-t', 'act-i', 'act-p'])
  })

  it('creates the new tables, constraints and indexes', () => {
    const tmp = phase2Database()
    const db = openDatabase(tmp.file)
    cleanups.push(() => closeDatabase(db))
    const names = (type: string) =>
      (db.prepare('SELECT name FROM sqlite_master WHERE type = ?').all(type) as { name: string }[]).map((r) => r.name)
    expect(names('table')).toEqual(expect.arrayContaining(['decisions', 'decision_items', 'decision_tasks', 'decision_tags', 'activity_events']))
    expect(names('table')).not.toContain('activity_events_v2')
    expect(names('index')).toEqual(
      expect.arrayContaining([
        'decisions_project_id',
        'decision_items_item_id',
        'decision_tasks_task_id',
        'decision_tags_tag_id',
        'activity_events_at',
        'activity_events_ref',
        'activity_events_project'
      ])
    )
    const fkTargets = (t: string) =>
      (db.prepare(`PRAGMA foreign_key_list(${t})`).all() as { table: string; on_delete: string }[]).map((r) => `${r.table}:${r.on_delete}`).sort()
    expect(fkTargets('decisions')).toEqual(['decisions:SET NULL', 'projects:SET NULL'])
    expect(fkTargets('decision_items')).toEqual(['decisions:CASCADE', 'items:CASCADE'])
    expect(fkTargets('decision_tasks')).toEqual(['decisions:CASCADE', 'tasks:CASCADE'])
    expect(fkTargets('decision_tags')).toEqual(['decisions:CASCADE', 'tags:CASCADE'])
    expect(db.pragma('foreign_key_check')).toEqual([])
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
    // the new activity kinds and the decision ref type are now accepted; unknown ones are not
    const ins = (kind: string, ref: string) =>
      db.prepare("INSERT INTO activity_events (id, kind, subject, ref_type, ref_id, origin, at) VALUES (?, ?, 's', ?, 'x', 'user', 'z')").run(`a-${kind}-${ref}`, kind, ref)
    expect(() => ins('decision_created', 'decision')).not.toThrow()
    expect(() => ins('bogus_kind', 'decision')).toThrow(/CHECK/)
    expect(() => ins('decision_created', 'bogus')).toThrow(/CHECK/)
  })

  it('does not re-apply the migration on later starts and never touches the data again', () => {
    const tmp = phase2Database()
    closeDatabase(openDatabase(tmp.file))
    const db = openDatabase(tmp.file)
    cleanups.push(() => closeDatabase(db))
    const svc = createWorkspaceService(db)
    const d = svc.createDecision({
      title: 'Survives',
      context: '',
      decision: 'yes',
      rationale: '',
      alternatives: '',
      consequences: '',
      status: 'accepted',
      decidedOn: null,
      projectId: 'proj-a',
      tagLabels: [],
      noteIds: ['item-1'],
      taskIds: ['task-1']
    }).decisions[0]!
    expect(runMigrations(db)).toEqual([])
    closeDatabase(db)
    const again = openDatabase(tmp.file)
    cleanups.push(() => closeDatabase(again))
    expect((again.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n).toBe(MIGRATIONS.length)
    expect(createWorkspaceService(again).getDecision(d.id)).toMatchObject({ noteIds: ['item-1'], taskIds: ['task-1'], projectId: 'proj-a' })
    expect((again.prepare('SELECT COUNT(*) AS n FROM activity_events').get() as { n: number }).n).toBe(5 + 1)
  })

  it('rolls the whole migration back if it fails, leaving the Phase 2 data readable', () => {
    const tmp = phase2Database()
    const broken = [...MIGRATIONS.slice(0, 1), { ...MIGRATIONS[1]!, sql: `${MIGRATIONS[1]!.sql}\nINSERT INTO nowhere VALUES (1);` }]
    expect(() => openDatabase(tmp.file, { migrations: broken })).toThrow(/Migration 2 failed/)
    const raw = new Database(tmp.file)
    cleanups.push(() => raw.close())
    expect(currentSchemaVersion(raw)).toBe(1)
    expect(raw.prepare("SELECT name FROM sqlite_master WHERE name IN ('decisions', 'activity_events_v2')").all()).toEqual([])
    expect((raw.prepare('SELECT COUNT(*) AS n FROM activity_events').get() as { n: number }).n).toBe(5)
    expect(raw.prepare("SELECT sql FROM sqlite_master WHERE name = 'activity_events'").get()).toMatchObject({ sql: expect.not.stringContaining('project_id') })
  })

  it('does not seed sample decisions into an existing database but does into a new one', () => {
    const tmp = phase2Database()
    const old = openDatabase(tmp.file)
    cleanups.push(() => closeDatabase(old))
    expect(seedSampleDataIfNew(old)).toBe(false)
    expect((old.prepare('SELECT COUNT(*) AS n FROM decisions').get() as { n: number }).n).toBe(0)

    const fresh = tempDir()
    cleanups.push(fresh.cleanup)
    const db = openDatabase(fresh.file)
    cleanups.push(() => closeDatabase(db))
    expect(seedSampleDataIfNew(db)).toBe(true)
    const svc = createWorkspaceService(db)
    const sample = svc.loadWorkspace()
    expect(sample.decisions.length).toBeGreaterThan(0)
    expect(sample.decisions.every((d) => d.origin === 'sample')).toBe(true)
    expect(sample.decisions.find((d) => d.id === 'dec-sqlite')).toMatchObject({ noteIds: ['item-sqlite-decision'], taskIds: ['task-sqlite-windows'] })
    expect(sample.activity.every((a) => 'projectId' in a)).toBe(true)
  })
})
