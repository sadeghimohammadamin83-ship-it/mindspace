/**
 * Consistent SQLite snapshots with better-sqlite3's online backup API (the
 * SQLite Backup C API). It reads the live database page by page inside read
 * transactions, so it is safe in WAL mode (the app's configured mode) while
 * other statements keep running; pages changed by the same connection during
 * the copy are included, so the result is always one coherent state. Each step
 * yields to the event loop, which keeps the UI responsive.
 */
import Database, { type Database as Db } from 'better-sqlite3'
import type { BackupCounts } from '@shared/backup'
import { BackupError } from './errors'
import { STORED_NAME } from './paths'

export interface DbFacts {
  schemaVersion: number
  counts: BackupCounts
  sqliteVersion: string
  documents: { id: string; storedName: string }[]
}

const COUNT_SQL: Record<keyof BackupCounts, string> = {
  notes: 'SELECT COUNT(*) FROM items',
  projects: 'SELECT COUNT(*) FROM projects',
  tasks: 'SELECT COUNT(*) FROM tasks',
  decisions: 'SELECT COUNT(*) FROM decisions',
  tags: 'SELECT COUNT(*) FROM tags',
  documents: 'SELECT COUNT(*) FROM documents',
  conversations: 'SELECT COUNT(*) FROM conversations',
  semanticChunks: 'SELECT COUNT(*) FROM semantic_chunks'
}

export function readFacts(db: Db): DbFacts {
  const counts = {} as BackupCounts
  for (const [key, sql] of Object.entries(COUNT_SQL)) {
    try {
      counts[key as keyof BackupCounts] = db.prepare(sql).pluck().get() as number
    } catch {
      counts[key as keyof BackupCounts] = 0 // table does not exist in an older schema
    }
  }
  let schemaVersion = 0
  try {
    schemaVersion = (db.prepare('SELECT MAX(version) FROM schema_migrations').pluck().get() as number | null) ?? 0
  } catch {
    schemaVersion = 0
  }
  let documents: DbFacts['documents'] = []
  try {
    documents = (db.prepare('SELECT id, stored_name FROM documents').all() as { id: string; stored_name: string }[]).map((r) => ({ id: r.id, storedName: r.stored_name }))
  } catch {
    documents = []
  }
  const sqliteVersion = db.prepare('SELECT sqlite_version()').pluck().get() as string
  return { schemaVersion, counts, sqliteVersion, documents }
}

/** Integrity checks that must pass before a database counts as usable. Throws BackupError otherwise. */
/** `untrusted`: the file came from a backup, so its contents (not just its structure) must also be benign. */
export function assertDatabaseHealthy(db: Db, opts: { untrusted?: boolean } = {}): void {
  const result = db.pragma('integrity_check') as { integrity_check: string }[]
  if (result.length !== 1 || result[0]!.integrity_check !== 'ok') {
    throw new BackupError('database_integrity', 'The database inside the backup failed its integrity check.')
  }
  const fk = db.pragma('foreign_key_check') as unknown[]
  if (fk.length > 0) throw new BackupError('database_integrity', 'The database inside the backup has broken references.')
  // Checksums only prove the file is unchanged, not that its contents are benign: a crafted database could name
  // a "managed" document outside the documents folder, which a later remove would delete.
  const hasDocs = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'documents'").get()
  if (opts.untrusted && hasDocs) {
    for (const { stored_name } of db.prepare('SELECT stored_name FROM documents').iterate() as Iterable<{ stored_name: unknown }>) {
      if (typeof stored_name !== 'string' || !STORED_NAME.test(stored_name)) {
        throw new BackupError('database_integrity', 'The database inside the backup refers to a document file name that is not allowed.')
      }
    }
  }
}

/** Opens a database file read-only and independently of the live one. */
export function openReadOnly(file: string): Db {
  try {
    return new Database(file, { readonly: true, fileMustExist: true })
  } catch {
    throw new BackupError('database_integrity', 'The database inside the backup cannot be opened.')
  }
}

/** Copies the live database to `dest` and finishes it as a single self-contained, checked file. */
export async function snapshotDatabase(live: Db, dest: string, onStep?: (done: number, total: number) => void): Promise<DbFacts & { journalModeAtBackup: string }> {
  const journalModeAtBackup = String(live.pragma('journal_mode', { simple: true }))
  try {
    await live.backup(dest, {
      progress: ({ totalPages, remainingPages }) => {
        onStep?.(totalPages - remainingPages, totalPages)
        return 200 // pages per step; the event loop runs between steps
      }
    })
  } catch (err) {
    if ((err as { code?: string })?.code === 'SQLITE_BUSY' || (err as { code?: string })?.code === 'SQLITE_LOCKED') {
      throw new BackupError('locked', 'The database was busy for too long. Try again in a moment.')
    }
    throw err
  }
  const snap = new Database(dest)
  try {
    snap.pragma('journal_mode = DELETE') // single file, no -wal/-shm companions
    assertDatabaseHealthy(snap)
    return { ...readFacts(snap), journalModeAtBackup }
  } finally {
    snap.close()
  }
}
