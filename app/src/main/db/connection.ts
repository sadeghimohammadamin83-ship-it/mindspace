/**
 * Opens the MINDSPACE database. Used by the main process at start-up and by
 * tests with temporary files. Never deletes, truncates or replaces a file:
 * if anything fails, the error propagates and the file is left untouched.
 */
import Database, { type Database as Db } from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { MIGRATIONS, runMigrations, type Migration } from './migrations'

export const DATABASE_FILE_NAME = 'mindspace.sqlite3'

export interface OpenOptions {
  migrations?: readonly Migration[]
  now?: () => Date
}

export function openDatabase(file: string, options: OpenOptions = {}): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new Database(file)
  try {
    db.pragma('foreign_keys = ON')
    db.pragma('busy_timeout = 3000')
    if (file !== ':memory:') db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
    if (db.pragma('foreign_keys', { simple: true }) !== 1) throw new Error('Could not enable foreign keys')
    const integrity = db.pragma('quick_check', { simple: true })
    if (integrity !== 'ok') throw new Error(`Database integrity check failed: ${String(integrity)}`)
    runMigrations(db, options.migrations ?? MIGRATIONS, options.now)
    return db
  } catch (err) {
    db.close()
    throw err
  }
}

export function closeDatabase(db: Db): void {
  if (!db.open) return
  try {
    if (db.pragma('journal_mode', { simple: true }) === 'wal') db.pragma('wal_checkpoint(TRUNCATE)')
  } finally {
    db.close()
  }
}
