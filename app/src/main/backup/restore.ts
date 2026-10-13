/**
 * Staged restore with rollback.
 *
 * Windows cannot replace a database file that is open, so activation happens
 * at the next start, before any connection exists:
 *
 *   running app:  validate backup → verified safety backup of current data →
 *                 extract + re-check into restore-staging/<id> → write journal
 *                 {state: staged} → restart.
 *   next start:   journal staged → activating: move the current database
 *                 (+wal/shm) and documents folder into restore-previous/<id>
 *                 (renames, nothing is deleted), move the staged copies in,
 *                 validate → activated. The app then opens the database; only
 *                 when that works is the restore marked completed and the
 *                 previous copy discarded.
 *   any failure or crash while "activating", or an activated database that
 *   will not open: everything moved aside is moved back (rollback).
 *
 * Journal path layout is derived from the restore id; nothing in the journal
 * names a path, so a tampered journal cannot redirect file operations.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { extractEntry } from './container'
import { BackupError } from './errors'
import type { VerifyReport } from './inspect'
import { DB_ENTRY, DOC_PREFIX } from './paths'
import { assertDatabaseHealthy, openReadOnly, readFacts } from './snapshot'

export const DB_NAME = 'mindspace.sqlite3'
const JOURNAL = 'restore-journal.json'
const STAGING = 'restore-staging'
const PREVIOUS = 'restore-previous'

const journalSchema = z.object({
  version: z.literal(1),
  id: z.string().regex(/^[a-f0-9]{32}$/),
  state: z.enum(['staged', 'activating', 'activated', 'completed', 'rolled_back', 'failed']),
  createdAt: z.string(),
  updatedAt: z.string(),
  message: z.string().max(400)
})
export type RestoreJournal = z.infer<typeof journalSchema>

export interface RestorePaths {
  userData: string
  journal: string
  staged: string
  previous: string
}

export function restorePaths(userData: string, id: string): RestorePaths {
  return { userData, journal: join(userData, JOURNAL), staged: join(userData, STAGING, id), previous: join(userData, PREVIOUS, id) }
}

export function readJournal(userData: string): RestoreJournal | null {
  try {
    return journalSchema.parse(JSON.parse(readFileSync(join(userData, JOURNAL), 'utf8')))
  } catch {
    return null
  }
}

function writeJournal(userData: string, j: RestoreJournal): void {
  const file = join(userData, JOURNAL)
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(j, null, 2))
  renameSync(tmp, file)
}

const setState = (userData: string, j: RestoreJournal, state: RestoreJournal['state'], message: string, now: Date): RestoreJournal => {
  const next = { ...j, state, message, updatedAt: now.toISOString() }
  writeJournal(userData, next)
  return next
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** Rename with a few retries: antivirus and indexers briefly lock files on Windows. */
function move(from: string, to: string): void {
  for (let i = 0; ; i++) {
    try {
      renameSync(from, to)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (i < 5 && (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES')) {
        sleep(200 * (i + 1))
        continue
      }
      throw err
    }
  }
}

export async function stageRestore(opts: { userData: string; id: string; report: VerifyReport }): Promise<void> {
  const p = restorePaths(opts.userData, opts.id)
  assertNoPending(opts.userData)
  rmSync(p.staged, { recursive: true, force: true })
  await mkdir(join(p.staged, 'documents'), { recursive: true })
  const { container, manifest } = opts.report
  const sums = new Map(manifest.files.map((f) => [f.path, f.sha256]))
  for (const e of container.entries) {
    if (e.name === 'manifest.json') continue
    const dest = e.name === DB_ENTRY ? join(p.staged, DB_NAME) : join(p.staged, 'documents', e.name.slice(DOC_PREFIX.length))
    const digest = await extractEntry(container, e, dest)
    if (digest !== sums.get(e.name)) throw new BackupError('checksum', 'A file changed while it was being prepared for restore.')
  }
  // Re-validate what was actually written.
  const db = openReadOnly(join(p.staged, DB_NAME))
  try {
    assertDatabaseHealthy(db, { untrusted: true })
    if (readFacts(db).schemaVersion !== manifest.database.schemaVersion) throw new BackupError('database_integrity', 'The prepared database does not match the backup.')
  } finally {
    db.close()
  }
}

function assertNoPending(userData: string): void {
  const existing = readJournal(userData)
  if (existing && ['staged', 'activating', 'activated'].includes(existing.state)) throw new BackupError('busy', 'Another restore is still in progress.')
}

/** The commit point: once the journal says "staged", the next start applies the restore. */
export function armRestore(userData: string, id: string, now: Date = new Date()): void {
  assertNoPending(userData)
  writeJournal(userData, { version: 1, id, state: 'staged', createdAt: now.toISOString(), updatedAt: now.toISOString(), message: 'Restore is prepared and will be applied when MINDSPACE restarts.' })
}

export function discardStaging(userData: string, id: string): void {
  rmSync(restorePaths(userData, id).staged, { recursive: true, force: true })
}

export function clearJournal(userData: string): void {
  const j = readJournal(userData)
  if (j && !['staged', 'activating', 'activated'].includes(j.state)) rmSync(join(userData, JOURNAL), { force: true })
}

export interface Hooks {
  /** Test seam: called after each named step; throwing simulates a crash or failure there. */
  afterStep?: (step: string) => void
}

const DB_FILES = [DB_NAME, `${DB_NAME}-wal`, `${DB_NAME}-shm`]

/** Moves everything that was set aside back; anything that took its place is parked in staging, not deleted. */
function rollback(p: RestorePaths): void {
  const park = join(p.staged, 'rolled-back')
  for (const name of [...DB_FILES, 'documents']) {
    const aside = join(p.previous, name)
    if (!existsSync(aside)) continue
    const live = join(p.userData, name)
    if (existsSync(live)) {
      mkdirSync(park, { recursive: true })
      move(live, join(park, name))
    }
    move(aside, live)
  }
}

export type StartupRestore =
  | { action: 'none' }
  | { action: 'activated'; id: string }
  | { action: 'rolled_back'; id: string; message: string }

/** Runs before the database is opened. Never throws: a failure becomes a rollback. */
export function recoverPendingRestore(userData: string, hooks: Hooks = {}, now: () => Date = () => new Date()): StartupRestore {
  const j = readJournal(userData)
  if (!j) return { action: 'none' }
  const p = restorePaths(userData, j.id)
  try {
    if (j.state === 'activating') {
      // The previous run died half way: undo whatever it did.
      rollback(p)
      setState(userData, j, 'rolled_back', 'A previous restore was interrupted. Your earlier data was put back.', now())
      return { action: 'rolled_back', id: j.id, message: 'interrupted' }
    }
    if (j.state === 'activated') return { action: 'activated', id: j.id }
    if (j.state !== 'staged') return { action: 'none' }

    if (!existsSync(join(p.staged, DB_NAME))) {
      setState(userData, j, 'failed', 'The prepared restore data was not found. Nothing was changed.', now())
      return { action: 'rolled_back', id: j.id, message: 'missing staging' }
    }
    const active = setState(userData, j, 'activating', 'Applying the restore.', now())
    try {
      mkdirSync(p.previous, { recursive: true })
      for (const name of DB_FILES) {
        if (existsSync(join(userData, name))) move(join(userData, name), join(p.previous, name))
        hooks.afterStep?.(`moved:${name}`)
      }
      if (existsSync(join(userData, 'documents'))) move(join(userData, 'documents'), join(p.previous, 'documents'))
      hooks.afterStep?.('moved:documents')
      move(join(p.staged, DB_NAME), join(userData, DB_NAME))
      hooks.afterStep?.('installed:db')
      move(join(p.staged, 'documents'), join(userData, 'documents'))
      hooks.afterStep?.('installed:documents')
      const db = openReadOnly(join(userData, DB_NAME))
      try {
        assertDatabaseHealthy(db)
      } finally {
        db.close()
      }
      hooks.afterStep?.('validated')
      setState(userData, active, 'activated', 'Restored data is in place and is being checked.', now())
      return { action: 'activated', id: j.id }
    } catch {
      rollback(p)
      setState(userData, active, 'rolled_back', 'The restore could not be applied. Your earlier data was put back unchanged.', now())
      return { action: 'rolled_back', id: j.id, message: 'activation failed' }
    }
  } catch {
    // Even the rollback hit a problem: leave the journal as it is so the next start tries again.
    return { action: 'none' }
  }
}

/** Called when an activated database cannot be opened by the app: undo the restore. */
export function rollbackActivated(userData: string, now: () => Date = () => new Date()): boolean {
  const j = readJournal(userData)
  if (!j || j.state !== 'activated') return false
  const p = restorePaths(userData, j.id)
  try {
    rollback(p)
    setState(userData, j, 'rolled_back', 'The restored data could not be opened. Your earlier data was put back unchanged.', now())
    return true
  } catch {
    return false
  }
}

/** Called once the restored database opened and passed its checks. Discards the raw copy of the old data. */
export function completeRestore(userData: string, now: () => Date = () => new Date()): void {
  const j = readJournal(userData)
  if (!j || j.state !== 'activated') return
  const p = restorePaths(userData, j.id)
  setState(userData, j, 'completed', 'The backup was restored. A safety backup of the previous data was kept.', now())
  rmSync(p.previous, { recursive: true, force: true })
  rmSync(p.staged, { recursive: true, force: true })
}
