/**
 * Verifies a backup file without touching live data: container structure and
 * authentication, manifest, inventory, sizes, checksums, then the database
 * snapshot opened on its own (extracted to a throwaway folder) and its
 * relationship to the document files. "Archive intact" is not the same as
 * "everything restores", so the report keeps them apart.
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Inspection, Issue } from '@shared/backup'
import { BACKUP_FORMAT_VERSION } from '@shared/backup'
import { BackupError } from './errors'
import { extractEntry, openContainer, readEntry, sha256Range, type OpenedContainer } from './container'
import { COMPONENT_NOTES, manifestSchema, type Manifest } from './manifest'
import { DB_ENTRY, DOC_PREFIX, MANIFEST_NAME } from './paths'
import { assertDatabaseHealthy, openReadOnly, readFacts } from './snapshot'

export interface VerifyReport {
  manifest: Manifest
  container: OpenedContainer
  issues: Issue[]
  archiveOk: boolean
  databaseOk: boolean
  compatible: boolean
  compatibilityNote: string
  documentFiles: number
  /** Where the database was extracted to (inside tmpDir), for restore staging. */
  dbFile: string
}

export async function verifyBackupFile(opts: {
  file: string
  password?: string | undefined
  tmpDir: string
  /** Highest schema version this app can open. */
  latestSchema: number
  onProgress?: (done: number, total: number) => void
}): Promise<VerifyReport> {
  await mkdir(opts.tmpDir, { recursive: true })
  const container = await openContainer(opts.file, opts.password, opts.tmpDir)
  const issues: Issue[] = []

  const manifestEntry = container.entries[0]!
  let manifest: Manifest
  try {
    manifest = manifestSchema.parse(JSON.parse((await readEntry(container, manifestEntry)).toString('utf8')))
  } catch {
    throw new BackupError('invalid_manifest', 'The backup manifest is missing or invalid.')
  }
  if (manifest.formatVersion !== container.header.formatVersion || manifest.encrypted !== container.header.encrypted) {
    throw new BackupError('invalid_manifest', 'The backup manifest does not match the backup file.')
  }
  if (manifest.compatibility.minReaderFormat > BACKUP_FORMAT_VERSION) {
    throw new BackupError('unsupported_format', 'This backup needs a newer version of MINDSPACE.')
  }

  // Inventory: manifest and archive must list exactly the same files.
  const data = container.entries.filter((e) => e.name !== MANIFEST_NAME)
  const listed = new Map(manifest.files.map((f) => [f.path, f]))
  if (listed.size !== manifest.files.length) throw new BackupError('invalid_manifest', 'The backup manifest lists a file twice.')
  for (const e of data) {
    const f = listed.get(e.name)
    if (!f) throw new BackupError('invalid_manifest', 'The backup contains a file that its manifest does not list.')
    if (f.size !== e.size) throw new BackupError('checksum', 'A file in the backup has a different size than its manifest says.')
  }
  const present = new Set(data.map((e) => e.name))
  const missingFromArchive = manifest.files.filter((f) => !present.has(f.path))
  if (missingFromArchive.length > 0) throw new BackupError('missing_files', 'The backup is missing files that its manifest lists.')
  if (!present.has(DB_ENTRY)) throw new BackupError('missing_files', 'The backup does not contain a database.')

  // Checksums.
  const total = data.reduce((n, e) => n + e.size, 0)
  let done = 0
  for (const e of data) {
    const digest = await sha256Range(container, e, (n) => opts.onProgress?.(done + n, total))
    done += e.size
    if (digest !== listed.get(e.name)!.sha256) throw new BackupError('checksum', 'A file in the backup does not match its checksum: the backup is damaged or has been modified.')
  }

  // Database on its own.
  const dbFile = join(opts.tmpDir, 'verify.sqlite3')
  await extractEntry(container, container.entries.find((e) => e.name === DB_ENTRY)!, dbFile)
  const db = openReadOnly(dbFile)
  let databaseOk = false
  try {
    assertDatabaseHealthy(db, { untrusted: true })
    const facts = readFacts(db)
    if (facts.schemaVersion !== manifest.database.schemaVersion) {
      throw new BackupError('invalid_manifest', 'The database version does not match the manifest.')
    }
    databaseOk = true
    const stored = new Set(data.filter((e) => e.name.startsWith(DOC_PREFIX)).map((e) => e.name.slice(DOC_PREFIX.length)))
    const missingDocs = facts.documents.filter((d) => !stored.has(d.storedName))
    if (missingDocs.length > 0) {
      issues.push({
        severity: 'warning',
        code: 'missing_documents',
        message: `${missingDocs.length} imported document file(s) are not in this backup. Their extracted text is kept, but the original files cannot be opened after restoring.`
      })
    }
    const known = new Set(facts.documents.map((d) => d.storedName))
    const orphans = [...stored].filter((n) => !known.has(n))
    if (orphans.length > 0) issues.push({ severity: 'warning', code: 'orphan_documents', message: `${orphans.length} document file(s) in the backup are not referenced by the database and will be ignored.` })
  } finally {
    db.close()
  }

  let compatible = true
  let compatibilityNote = 'Compatible with this version of MINDSPACE.'
  if (manifest.compatibility.restoreNeedsSchemaAtLeast > opts.latestSchema || manifest.database.schemaVersion > opts.latestSchema) {
    compatible = false
    compatibilityNote = 'This backup was made by a newer version of MINDSPACE. Update the app to restore it.'
  } else if (manifest.database.schemaVersion < opts.latestSchema) {
    compatibilityNote = 'This backup is from an older version. It is upgraded to the current database format when restored.'
  }
  if (manifest.platform !== process.platform) {
    issues.push({ severity: 'warning', code: 'other_platform', message: 'This backup was made on a different operating system.' })
  }

  return {
    manifest,
    container,
    issues,
    archiveOk: true,
    databaseOk,
    compatible,
    compatibilityNote,
    documentFiles: data.filter((e) => e.name.startsWith(DOC_PREFIX)).length,
    dbFile
  }
}

export function toInspection(report: VerifyReport, token: string): Inspection {
  const m = report.manifest
  return {
    token,
    encrypted: m.encrypted,
    formatVersion: m.formatVersion,
    createdAt: m.createdAt,
    appVersion: m.app.version,
    schemaVersion: m.database.schemaVersion,
    kind: m.kind,
    platform: m.platform,
    bytes: report.container.fileBytes,
    counts: m.counts,
    documentFiles: report.documentFiles,
    components: m.components,
    archiveOk: report.archiveOk,
    databaseOk: report.databaseOk,
    issues: report.issues,
    compatible: report.compatible,
    compatibilityNote: report.compatibilityNote,
    canRestore: report.archiveOk && report.databaseOk && report.compatible
  }
}

export { COMPONENT_NOTES }
