import type { Database } from 'better-sqlite3'
import { migration0001 } from './0001_initial'
import { migration0002 } from './0002_project_memory'
import { migration0003 } from './0003_documents_search'
import { migration0004 } from './0004_semantic_index'
import { migration0005 } from './0005_conversations'

export interface Migration {
  version: number
  name: string
  sql: string
}

/** Append-only. Never edit or reorder a migration that has shipped; add a new one. */
export const MIGRATIONS: readonly Migration[] = [migration0001, migration0002, migration0003, migration0004, migration0005]

export class MigrationError extends Error {
  constructor(
    readonly version: number,
    cause: unknown
  ) {
    super(`Migration ${version} failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause })
    this.name = 'MigrationError'
  }
}

/**
 * Applies pending migrations in version order, each in its own transaction
 * together with its `schema_migrations` row, so a failed migration leaves the
 * database exactly as it was before that migration. Returns versions applied.
 */
export function runMigrations(db: Database, migrations: readonly Migration[] = MIGRATIONS, now = () => new Date()): number[] {
  const versions = migrations.map((m) => m.version)
  if (versions.some((v, i) => !Number.isInteger(v) || v <= 0 || (i > 0 && v <= versions[i - 1]!))) {
    throw new Error('Migrations must have strictly increasing positive integer versions')
  }
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL
  ) STRICT`)

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((r) => r.version)
  )
  const newest = Math.max(0, ...applied)
  const known = Math.max(0, ...versions)
  if (newest > known) {
    // A newer app version created this file. Refuse rather than guess.
    throw new Error(`Database schema version ${newest} is newer than this app supports (${known})`)
  }

  const record = db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
  const done: number[] = []
  for (const m of migrations) {
    if (applied.has(m.version)) continue
    try {
      db.transaction(() => {
        db.exec(m.sql)
        record.run(m.version, m.name, now().toISOString())
      }).immediate()
    } catch (err) {
      throw new MigrationError(m.version, err)
    }
    const violations = db.prepare('PRAGMA foreign_key_check').all()
    if (violations.length) throw new MigrationError(m.version, new Error('foreign key check failed'))
    done.push(m.version)
  }
  return done
}

export function currentSchemaVersion(db: Database): number {
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null }
  return row.v ?? 0
}
