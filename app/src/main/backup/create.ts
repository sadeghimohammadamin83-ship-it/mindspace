/**
 * Backup creation. Order matters:
 *   space check → consistent DB snapshot (online backup API) → copy the
 *   managed documents the snapshot references → manifest + checksums →
 *   write container to a ".part" file next to its destination → fully verify
 *   that file (decrypting if needed) → publish by rename, never over an
 *   existing file → report. A backup is only reported as done after
 *   verification; every failure removes the partial file and the staging folder.
 */
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, readdir, rename, rm, stat, statfs } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import type { Database } from 'better-sqlite3'
import { BACKUP_EXTENSION, BACKUP_FORMAT_VERSION, type BackupKind } from '@shared/backup'
import { sha256File, writeContainer, type PackFile } from './container'
import { BackupError, toBackupError } from './errors'
import { verifyBackupFile, type VerifyReport } from './inspect'
import { COMPONENT_NOTES, type Manifest } from './manifest'
import { DB_ENTRY, DOC_PREFIX, STORED_NAME } from './paths'
import { snapshotDatabase } from './snapshot'

export interface CreateDeps {
  db: Database
  documentsDir: string
  /** Scratch space owned by the backup system; only children created here are ever removed. */
  tmpRoot: string
  appVersion: string
  latestSchema: number
  now?: () => Date
  onProgress?: (phase: string, done?: number, total?: number) => void
}

export interface CreateOptions {
  kind: BackupKind
  /** Desired final file. If it exists a numbered name is used instead. */
  destFile: string
  password?: string | undefined
}

export interface Created {
  file: string
  renamed: boolean
  bytes: number
  manifest: Manifest
  report: VerifyReport
}

const MARGIN = 64 * 1024 * 1024

async function assertSpace(dir: string, need: number): Promise<void> {
  try {
    const s = await statfs(dir)
    if (s.bavail * s.bsize < need) throw new BackupError('disk_full', 'There is not enough free disk space for this backup.')
  } catch (err) {
    if (err instanceof BackupError) throw err
    // statfs unsupported or folder missing: let the write itself report the real problem.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw toBackupError(err)
  }
}

/** Picks `name`, `name (2)`, `name (3)`… so an existing file is never replaced. */
export function freeName(file: string): { file: string; renamed: boolean } {
  if (!existsSync(file)) return { file, renamed: false }
  const dir = dirname(file)
  const ext = extname(file)
  const stem = basename(file, ext)
  for (let n = 2; n < 10_000; n++) {
    const candidate = join(dir, `${stem} (${n})${ext}`)
    if (!existsSync(candidate)) return { file: candidate, renamed: true }
  }
  throw new BackupError('internal', 'Could not find a free file name.')
}

export async function createBackupFile(deps: CreateDeps, opts: CreateOptions): Promise<Created> {
  const now = deps.now ?? (() => new Date())
  const progress = deps.onProgress ?? (() => undefined)
  const work = join(deps.tmpRoot, `create-${randomUUID()}`)
  const destDir = dirname(opts.destFile)
  const part = join(destDir, `.${basename(opts.destFile)}.${randomUUID().slice(0, 8)}.part`)
  try {
    await mkdir(work, { recursive: true })
    await mkdir(destDir, { recursive: true })

    // Rough size for the space check: database file + managed documents.
    let docBytes = 0
    try {
      for (const n of await readdir(deps.documentsDir)) if (STORED_NAME.test(n)) docBytes += (await stat(join(deps.documentsDir, n))).size
    } catch {
      /* no documents folder yet */
    }
    const dbBytes = (deps.db.pragma('page_count', { simple: true }) as number) * (deps.db.pragma('page_size', { simple: true }) as number)
    const estimate = dbBytes + docBytes
    await assertSpace(deps.tmpRoot, estimate + MARGIN)
    await assertSpace(destDir, estimate + MARGIN)

    progress('snapshot')
    const dbCopy = join(work, 'mindspace.sqlite3')
    const facts = await snapshotDatabase(deps.db, dbCopy, (d, t) => progress('snapshot', d, t))

    progress('collect')
    const files: PackFile[] = []
    const entries: Manifest['files'] = []
    const dbStat = await stat(dbCopy)
    files.push({ name: DB_ENTRY, source: dbCopy, size: dbStat.size })
    entries.push({ path: DB_ENTRY, size: dbStat.size, sha256: await sha256File(dbCopy), component: 'database' })
    // Only documents the snapshot references: the bundle stays coherent and unowned files are never swept in.
    const missing: string[] = []
    for (const d of facts.documents) {
      if (!STORED_NAME.test(d.storedName)) continue
      const src = join(deps.documentsDir, d.storedName)
      const copy = join(work, d.storedName)
      try {
        await copyFile(src, copy)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          missing.push(d.storedName)
          continue
        }
        throw err
      }
      const st = await stat(copy)
      files.push({ name: `${DOC_PREFIX}${d.storedName}`, source: copy, size: st.size })
      entries.push({ path: `${DOC_PREFIX}${d.storedName}`, size: st.size, sha256: await sha256File(copy), component: 'documents' })
    }

    const manifest: Manifest = {
      format: 'mindspace-backup',
      formatVersion: BACKUP_FORMAT_VERSION,
      createdAt: now().toISOString(),
      kind: opts.kind,
      app: { name: 'MINDSPACE', version: deps.appVersion },
      platform: process.platform,
      encrypted: Boolean(opts.password),
      database: { schemaVersion: facts.schemaVersion, method: 'sqlite-online-backup (better-sqlite3)', sqliteVersion: facts.sqliteVersion, journalModeAtBackup: facts.journalModeAtBackup },
      counts: facts.counts,
      components: [
        { id: 'database', included: true, note: COMPONENT_NOTES.database },
        { id: 'documents', included: true, note: missing.length ? `${COMPONENT_NOTES.documents} ${missing.length} file(s) were already missing on disk.` : COMPONENT_NOTES.documents },
        { id: 'credentials', included: false, note: COMPONENT_NOTES.credentials },
        { id: 'models', included: false, note: COMPONENT_NOTES.models },
        { id: 'caches', included: false, note: COMPONENT_NOTES.caches }
      ],
      files: entries,
      compatibility: {
        minReaderFormat: BACKUP_FORMAT_VERSION,
        restoreNeedsSchemaAtLeast: facts.schemaVersion,
        note: 'Restorable by MINDSPACE versions that know this database version or a newer one. Older backups are upgraded on restore; newer ones are refused.'
      }
    }
    const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8')

    progress('write')
    await writeContainer({ dest: part, manifest: manifestBuf, files, password: opts.password, onProgress: (d, t) => progress('write', d, t) })

    progress('verify')
    const report = await verifyBackupFile({
      file: part,
      password: opts.password,
      tmpDir: join(work, 'verify'),
      latestSchema: deps.latestSchema,
      onProgress: (d, t) => progress('verify', d, t)
    })
    // Independent check that what was verified is what we meant to write.
    if (createHash('sha256').update(manifestBuf).digest('hex') !== createHash('sha256').update(Buffer.from(JSON.stringify(report.manifest, null, 2), 'utf8')).digest('hex')) {
      throw new BackupError('invalid_manifest', 'The written manifest differs from the intended one.')
    }

    progress('publish')
    const target = freeName(opts.destFile)
    await rename(part, target.file)
    const bytes = (await stat(target.file)).size
    return { file: target.file, renamed: target.renamed, bytes, manifest, report }
  } catch (err) {
    await rm(part, { force: true }).catch(() => undefined)
    throw toBackupError(err)
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined)
  }
}

export const defaultFileName = (kind: BackupKind, at: Date): string => {
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}_${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`
  const prefix = kind === 'auto' ? 'mindspace-auto' : kind === 'safety' ? 'mindspace-safety' : 'mindspace-backup'
  return `${prefix}_${stamp}.${BACKUP_EXTENSION}`
}
