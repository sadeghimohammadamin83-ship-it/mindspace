// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { closeDatabase, openDatabase } from '../../src/main/db/connection'
import { MIGRATIONS, MigrationError, currentSchemaVersion, runMigrations } from '../../src/main/db/migrations'
import { seedSampleDataIfNew } from '../../src/main/db/seed'
import { createWorkspaceService } from '../../src/main/services/workspace-service'
import { tempDir } from './helpers/db'

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((f) => f()))
function temp() {
  const t = tempDir()
  cleanups.push(t.cleanup)
  return t
}
const count = (db: Database.Database, table: string) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n

describe('database initialisation', () => {
  it('creates the folder and file, enables foreign keys and WAL, applies all migrations', () => {
    const { dir } = temp()
    const file = `${dir}/nested/profile/mindspace.sqlite3`
    const db = openDatabase(file)
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(currentSchemaVersion(db)).toBe(MIGRATIONS.at(-1)!.version)
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name)
    expect(tables).toEqual(expect.arrayContaining(['projects', 'items', 'tags', 'item_tags', 'tasks', 'activity_events', 'preferences', 'schema_migrations']))
    closeDatabase(db)
  })

  it('does not re-run migrations on repeated initialisation', () => {
    const { file } = temp()
    closeDatabase(openDatabase(file))
    const db = openDatabase(file)
    expect(count(db, 'schema_migrations')).toBe(MIGRATIONS.length)
    expect(runMigrations(db)).toEqual([])
    closeDatabase(db)
  })

  it('applies a later migration once and keeps existing data', () => {
    const { file } = temp()
    const db1 = openDatabase(file)
    createWorkspaceService(db1).createProject({ name: 'Keep me', description: '', status: 'active' })
    closeDatabase(db1)
    const next = [...MIGRATIONS, { version: 99, name: 'add-color', sql: "ALTER TABLE projects ADD COLUMN color TEXT NOT NULL DEFAULT 'none'" }]
    const db2 = openDatabase(file, { migrations: next })
    expect(db2.prepare('SELECT name, color FROM projects').all()).toEqual([{ name: 'Keep me', color: 'none' }])
    expect(runMigrations(db2, next)).toEqual([])
    closeDatabase(db2)
  })

  it('rolls back a failing migration entirely and reports it', () => {
    const db = new Database(':memory:')
    const broken = [...MIGRATIONS, { version: MIGRATIONS.at(-1)!.version + 1, name: 'broken', sql: 'CREATE TABLE half (x INTEGER); INSERT INTO nope VALUES (1);' }]
    expect(() => runMigrations(db, broken)).toThrow(MigrationError)
    expect(currentSchemaVersion(db)).toBe(MIGRATIONS.at(-1)!.version)
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'half'").get()).toBeUndefined()
    db.close()
  })

  it('refuses a database created by a newer app version without changing it', () => {
    const { file } = temp()
    const db = openDatabase(file)
    db.prepare("INSERT INTO schema_migrations VALUES (500, 'future', 'x')").run()
    closeDatabase(db)
    expect(() => openDatabase(file)).toThrow(/newer than this app supports/)
    const raw = new Database(file)
    expect(count(raw, 'schema_migrations')).toBe(MIGRATIONS.length + 1)
    raw.close()
  })

  it('never replaces a file that is not a valid database', async () => {
    const { file } = temp()
    const { writeFileSync, readFileSync } = await import('node:fs')
    writeFileSync(file, 'definitely not sqlite')
    expect(() => openDatabase(file)).toThrow()
    expect(readFileSync(file, 'utf8')).toBe('definitely not sqlite')
  })
})

describe('schema constraints', () => {
  const db = openDatabase(':memory:')
  const now = '2026-10-12T00:00:00.000Z'
  it('enforces foreign keys', () => {
    expect(() =>
      db.prepare("INSERT INTO tasks (id, title, status, priority, project_id, created_at, updated_at) VALUES ('task-x', 'T', 'todo', 'low', 'proj-missing', ?, ?)").run(now, now)
    ).toThrow(/FOREIGN KEY/)
  })
  it('enforces enums, required titles and completion consistency', () => {
    const ins = db.prepare('INSERT INTO tasks (id, title, status, priority, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    expect(() => ins.run('task-a', 'T', 'doing', 'low', null, now, now)).toThrow(/CHECK/)
    expect(() => ins.run('task-b', '   ', 'todo', 'low', null, now, now)).toThrow(/CHECK/)
    expect(() => ins.run('task-c', 'T', 'done', 'low', null, now, now)).toThrow(/CHECK/)
    expect(() => ins.run('task-d', 'T', 'todo', 'urgent', null, now, now)).toThrow(/CHECK/)
  })
  it('requires a URL for links and unique tag keys', () => {
    expect(() =>
      db.prepare("INSERT INTO items (id, kind, title, created_at, updated_at) VALUES ('item-l', 'link', 'L', ?, ?)").run(now, now)
    ).toThrow(/CHECK/)
    db.prepare("INSERT INTO tags VALUES ('tag-a', 'A', 'a', ?)").run(now)
    expect(() => db.prepare("INSERT INTO tags VALUES ('tag-b', 'a', 'a', ?)").run(now)).toThrow(/UNIQUE/)
  })
})

describe('sample data', () => {
  it('seeds a brand-new database exactly once', () => {
    const { file } = temp()
    const db = openDatabase(file)
    expect(seedSampleDataIfNew(db)).toBe(true)
    const projects = count(db, 'projects')
    expect(projects).toBeGreaterThan(0)
    expect(seedSampleDataIfNew(db)).toBe(false)
    closeDatabase(db)
    const again = openDatabase(file)
    expect(seedSampleDataIfNew(again)).toBe(false)
    expect(count(again, 'projects')).toBe(projects)
    closeDatabase(again)
  })

  it('never seeds over user data, and does not return after samples are deleted', () => {
    const db = openDatabase(':memory:')
    const svc = createWorkspaceService(db)
    svc.createTask({ title: 'Mine', notes: '', status: 'todo', priority: 'low', dueDate: null, projectId: null })
    expect(seedSampleDataIfNew(db)).toBe(false)
    expect(count(db, 'tasks')).toBe(1)

    const fresh = openDatabase(':memory:')
    seedSampleDataIfNew(fresh)
    fresh.exec('DELETE FROM items; DELETE FROM tasks; DELETE FROM projects;')
    expect(seedSampleDataIfNew(fresh)).toBe(false)
    expect(count(fresh, 'items')).toBe(0)
  })
})

describe('persistence across connections', () => {
  it('keeps every record unchanged after close and reopen', () => {
    const { file } = temp()
    const db = openDatabase(file)
    const svc = createWorkspaceService(db)
    const p = svc.createProject({ name: 'پروژه', description: 'desc', status: 'planning' }).projects[0]!
    svc.createItem({ kind: 'link', title: 'Link', body: 'b', url: 'https://example.com', tagLabels: ['SQLite', 'جست‌وجو'], projectId: p.id })
    const t = svc.createTask({ title: 'Task', notes: 'n', status: 'todo', priority: 'high', dueDate: '2026-10-20', projectId: p.id }).tasks[0]!
    svc.setTaskStatus(t.id, 'done')
    svc.setPreferences({ lang: 'en', reduceMotion: true })
    const before = svc.loadWorkspace()
    closeDatabase(db)

    const reopened = openDatabase(file)
    const svc2 = createWorkspaceService(reopened)
    expect(svc2.loadWorkspace()).toEqual(before)
    expect(svc2.getPreferences()).toEqual({ lang: 'en', reduceMotion: true })
    closeDatabase(reopened)
  })
})
