/**
 * Backup bookkeeping lives in its own file in the user-data folder, not in
 * the database: restoring a backup must not roll back the list of backups,
 * the schedule or the destination. Only files recorded here are ever deleted
 * by retention.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { z } from 'zod'
import { RETENTION_DEFAULT, RETENTION_MAX, RETENTION_MIN } from '@shared/backup'
import { countsSchema } from './manifest'

const recordSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{32}$/),
  kind: z.enum(['manual', 'auto', 'safety']),
  file: z.string().min(1).max(1024),
  createdAt: z.string(),
  bytes: z.number().int().nonnegative(),
  encrypted: z.boolean(),
  appVersion: z.string().max(40),
  schemaVersion: z.number().int().nonnegative(),
  formatVersion: z.number().int().positive(),
  verification: z.enum(['verified', 'verified_with_warnings', 'failed', 'unverified']),
  verifiedAt: z.string().nullable(),
  counts: countsSchema.nullable()
})
export type StoredRecord = z.infer<typeof recordSchema>

const stateSchema = z.object({
  version: z.literal(1),
  config: z
    .object({
      autoEnabled: z.boolean().catch(false),
      frequency: z.enum(['daily', 'weekly']).catch('daily'),
      keepAuto: z.number().int().min(RETENTION_MIN).max(RETENTION_MAX).catch(RETENTION_DEFAULT)
    })
    .catch({ autoEnabled: false, frequency: 'daily', keepAuto: RETENTION_DEFAULT }),
  /** Custom folder for automatic backups; null = the default folder inside user data. */
  autoDir: z.string().max(1024).nullable().catch(null),
  lastAuto: z.object({ at: z.string(), ok: z.boolean(), message: z.string().max(300) }).nullable().catch(null),
  records: z.array(recordSchema.catch(null as never)).transform((r) => r.filter(Boolean)).catch([])
})
export type BackupState = z.infer<typeof stateSchema>

const EMPTY = (): BackupState => ({ version: 1, config: { autoEnabled: false, frequency: 'daily', keepAuto: RETENTION_DEFAULT }, autoDir: null, lastAuto: null, records: [] })
const MAX_RECORDS = 500

export function createStateStore(file: string) {
  let state: BackupState = EMPTY()
  if (existsSync(file)) {
    try {
      state = stateSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
    } catch {
      // Unreadable: keep the bad file for inspection and start with an empty list. Backup files themselves are untouched.
      try {
        renameSync(file, `${file}.corrupt`)
      } catch {
        /* ignore */
      }
      state = EMPTY()
    }
  }
  const save = () => {
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(state, null, 2))
    renameSync(tmp, file)
  }
  return {
    get: (): BackupState => state,
    update(fn: (s: BackupState) => void): BackupState {
      const next = structuredClone(state)
      fn(next)
      if (next.records.length > MAX_RECORDS) next.records = next.records.slice(-MAX_RECORDS)
      state = next
      save()
      return state
    }
  }
}
export type StateStore = ReturnType<typeof createStateStore>
