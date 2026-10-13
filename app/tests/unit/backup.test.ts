// @vitest-environment node
/**
 * Phase 8: backup, verification, restore, rollback, retention, scheduling and
 * the security boundaries around them. Everything runs against throwaway
 * folders and the real better-sqlite3 driver in WAL mode; nothing touches a
 * real profile.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Database } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { extractPdf } from '../../src/main/documents/extract'
import { closeDatabase, openDatabase } from '../../src/main/db/connection'
import { seedSampleDataIfNew } from '../../src/main/db/seed'
import { MIGRATIONS } from '../../src/main/db/migrations'
import { createDocumentService } from '../../src/main/services/document-service'
import { createWorkspaceService } from '../../src/main/services/workspace-service'
import { extractEntry, openContainer, readHeader, writeContainer } from '../../src/main/backup/container'
import { BackupError, toBackupError } from '../../src/main/backup/errors'
import { verifyBackupFile } from '../../src/main/backup/inspect'
import { armRestore, completeRestore, readJournal, recoverPendingRestore, rollbackActivated, stageRestore } from '../../src/main/backup/restore'
import { createBackupService, type BackupService } from '../../src/main/backup/service'
import { backupHandlers, backupResult } from '../../src/main/ipc/backup-handlers'
import { IpcChannel } from '@shared/ipc'
import { tempDir } from './helpers/db'

const LATEST = Math.max(...MIGRATIONS.map((m) => m.version))
const FIX = resolve(__dirname, '../fixtures/documents')
const SECRET = 'sk-ant-api03-SUPERSECRETKEYVALUE'

let tmp: ReturnType<typeof tempDir>
let userData: string
let docsDir: string
let db: Database
let svc: BackupService
let picks: string[] | null
let clock: number
const restarts: number[] = []
const maintenance: boolean[] = []
const dialog = { save: null as string | null, open: null as string | null, folder: null as string | null }

function open(): Database {
  return openDatabase(join(userData, 'mindspace.sqlite3'))
}

function makeService(latestSchema = LATEST) {
  return createBackupService({
    getDb: () => db,
    userData,
    documentsDir: docsDir,
    appVersion: '9.9.9',
    latestSchema,
    dialogs: { saveBackup: async () => dialog.save, openBackup: async () => dialog.open, chooseFolder: async () => dialog.folder },
    requestRestart: () => void restarts.push(1),
    setMaintenance: (on) => void maintenance.push(on),
    now: () => new Date(clock),
    tickMs: 60_000
  })
}

beforeEach(async () => {
  tmp = tempDir()
  userData = join(tmp.dir, 'userData')
  docsDir = join(userData, 'documents')
  mkdirSync(docsDir, { recursive: true })
  clock = Date.parse('2026-10-13T10:00:00Z')
  restarts.length = 0
  maintenance.length = 0
  dialog.save = dialog.open = dialog.folder = null
  db = open()
  seedSampleDataIfNew(db)
  const ws = createWorkspaceService(db)
  ws.createItem({ kind: 'note', title: 'Committed before backup', body: 'WAL mode matters', url: '', tagLabels: ['backup'], projectId: null })
  const docs = createDocumentService({ db, dir: docsDir, selectFiles: async () => picks, extractPdf: async (p) => extractPdf(new Uint8Array(readFileSync(p))) })
  picks = [join(FIX, 'sample-text-pdf.pdf'), join(FIX, 'sample-document.md')]
  await docs.importDocuments()
  await docs.idle()
  // One semantic source with an embedding, so the index is part of the data under test.
  const item = db.prepare('SELECT id, updated_at FROM items LIMIT 1').get() as { id: string; updated_at: string }
  db.prepare("INSERT INTO semantic_sources (source_key, source_type, item_id, source_version, content_hash, model_id, status, chunk_count, indexed_at) VALUES ('item:1','item',?,?,?, 'm','ready',1,'2026-10-13T00:00:00Z')").run(item.id, item.updated_at, 'a'.repeat(64))
  db.prepare("INSERT INTO semantic_chunks (id, source_key, page, ordinal, char_start, char_end, text, model_id, dimensions, embedding, created_at) VALUES ('c1','item:1',NULL,0,0,5,'hello','m',2,?, '2026-10-13T00:00:00Z')").run(Buffer.alloc(8, 1))
  // A credentials file that must never end up in a backup.
  writeFileSync(join(userData, 'ai-credentials.json'), JSON.stringify({ version: 1, entries: { anthropic: { data: SECRET, updatedAt: 'x' } } }))
  svc = makeService()
})

afterEach(() => {
  vi.useRealTimers()
  svc.stopScheduler()
  try {
    closeDatabase(db)
  } catch {
    /* already closed */
  }
  tmp.cleanup()
})

const counts = (d: Database) => ({
  items: d.prepare('SELECT COUNT(*) FROM items').pluck().get() as number,
  docs: d.prepare('SELECT COUNT(*) FROM documents').pluck().get() as number,
  pages: d.prepare('SELECT COUNT(*) FROM document_pages').pluck().get() as number,
  chunks: d.prepare('SELECT COUNT(*) FROM semantic_chunks').pluck().get() as number,
  fts: d.prepare('SELECT COUNT(*) FROM search_index').pluck().get() as number,
  titles: (d.prepare('SELECT title FROM items ORDER BY title').pluck().all() as string[]).join('|')
})
const outFile = (name = 'out.msbak') => join(tmp.dir, 'exports', name)
async function manualBackup(password?: string, name?: string) {
  dialog.save = outFile(name)
  const r = await svc.create(password ? { password } : {})
  if (r.cancelled) throw new Error('cancelled')
  return r
}
const rawFiles = (dir: string) => (existsSync(dir) ? readdirSync(dir) : [])

describe('backup creation', () => {
  it('writes a verified backup with manifest, checksums, documents, index data and no secrets', async () => {
    const r = await manualBackup()
    expect(r.record.verification).toBe('verified')
    expect(r.record.counts?.documents).toBe(2)
    expect(r.record.counts?.semanticChunks).toBe(1)
    const file = outFile()
    const report = await verifyBackupFile({ file, tmpDir: join(tmp.dir, 'v'), latestSchema: LATEST })
    expect(report.archiveOk && report.databaseOk && report.compatible).toBe(true)
    const m = report.manifest
    expect(m.formatVersion).toBe(1)
    expect(m.database.schemaVersion).toBe(LATEST)
    expect(m.database.journalModeAtBackup).toBe('wal')
    expect(m.files.filter((f) => f.component === 'documents')).toHaveLength(2)
    expect(m.components.find((c) => c.id === 'credentials')?.included).toBe(false)
    for (const f of m.files) expect(f.sha256).toMatch(/^[a-f0-9]{64}$/)
    // Checksum of the stored database entry equals the real hash of the extracted bytes.
    const container = await openContainer(file, undefined, join(tmp.dir, 'c'))
    const dbEntry = container.entries.find((e) => e.name === 'data/database/mindspace.sqlite3')!
    await mkdir(join(tmp.dir, 'x'), { recursive: true })
    await extractEntry(container, dbEntry, join(tmp.dir, 'x', 'db'))
    expect(createHash('sha256').update(readFileSync(join(tmp.dir, 'x', 'db'))).digest('hex')).toBe(m.files.find((f) => f.path === dbEntry.name)!.sha256)
    // No secret in the archive or the manifest.
    expect(readFileSync(file).includes(SECRET)).toBe(false)
    expect(JSON.stringify(m)).not.toContain(SECRET)
    // The app is untouched and still works.
    expect(() => db.prepare("INSERT INTO items (id, kind, title, body, url, created_at, updated_at) VALUES ('z','note','after','','','2026-10-13T00:00:00Z','2026-10-13T00:00:00Z')").run()).not.toThrow()
    expect(rawFiles(join(tmp.dir, 'exports')).filter((n) => n.endsWith('.part'))).toEqual([])
    expect(rawFiles(join(userData, 'backup-tmp'))).toEqual([])
  })

  it('never overwrites an existing file and reports the new name', async () => {
    mkdirSync(join(tmp.dir, 'exports'))
    writeFileSync(outFile(), 'precious')
    const r = await manualBackup()
    expect(r.renamed).toBe(true)
    expect(r.record.fileName).toBe('out (2).msbak')
    expect(readFileSync(outFile(), 'utf8')).toBe('precious')
  })

  it('cancelled dialogs create nothing', async () => {
    dialog.save = null
    expect(await svc.create({})).toEqual({ cancelled: true })
    expect(svc.getStatus().records).toEqual([])
  })

  it('backs up while the database is being written and the snapshot is coherent', async () => {
    // Fill enough data that the copy takes several steps, then write between steps.
    const ins = db.prepare("INSERT INTO items (id, kind, title, body, url, created_at, updated_at) VALUES (?, 'note', ?, ?, '', '2026-10-13T00:00:00Z', '2026-10-13T00:00:00Z')")
    db.transaction(() => {
      for (let i = 0; i < 3000; i++) ins.run(`bulk-${i}`, `bulk ${i}`, 'x'.repeat(2000))
    })()
    const before = counts(db).items
    let writes = 0
    let stop = false
    const writer = (async () => {
      while (!stop) {
        db.transaction(() => {
          ins.run(`live-a-${writes}`, `live a ${writes}`, 'y')
          ins.run(`live-b-${writes}`, `live b ${writes}`, 'y')
        })()
        writes++
        await new Promise((r) => setImmediate(r))
      }
    })()
    const r = await manualBackup()
    stop = true
    await writer
    expect(writes).toBeGreaterThan(0)
    expect(r.record.verification).toBe('verified')
    // Pairs are written in one transaction: the snapshot never contains half a pair.
    const report = await verifyBackupFile({ file: outFile(), tmpDir: join(tmp.dir, 'v'), latestSchema: LATEST })
    const snap = (await import('better-sqlite3')).default(report.dbFile, { readonly: true })
    const a = snap.prepare("SELECT COUNT(*) FROM items WHERE id LIKE 'live-a-%'").pluck().get() as number
    const b = snap.prepare("SELECT COUNT(*) FROM items WHERE id LIKE 'live-b-%'").pluck().get() as number
    snap.close()
    expect(a).toBe(b)
    expect(report.manifest.counts.notes).toBeGreaterThanOrEqual(before)
  })

  it('records missing managed documents as a warning instead of failing or lying', async () => {
    const stored = readdirSync(docsDir)
    rmSync1(join(docsDir, stored[0]!))
    const r = await manualBackup()
    expect(r.record.verification).toBe('verified_with_warnings')
    const report = await verifyBackupFile({ file: outFile(), tmpDir: join(tmp.dir, 'v'), latestSchema: LATEST })
    expect(report.issues.map((i) => i.code)).toContain('missing_documents')
  })

  it('does not leave files or records behind when the destination is unusable', async () => {
    writeFileSync(join(tmp.dir, 'afile'), 'x')
    dialog.save = join(tmp.dir, 'afile', 'sub', 'out.msbak')
    await expect(svc.create({})).rejects.toMatchObject({ code: 'destination_unavailable' })
    expect(svc.getStatus().records).toEqual([])
    expect(rawFiles(join(userData, 'backup-tmp'))).toEqual([])
  })

  it('does not report success when the database cannot be read', async () => {
    closeDatabase(db)
    dialog.save = outFile()
    await expect(svc.create({})).rejects.toBeInstanceOf(BackupError)
    expect(svc.getStatus().records).toEqual([])
    expect(rawFiles(join(tmp.dir, 'exports'))).toEqual([])
    db = open()
  })

  it('refuses destinations inside the live data folders', async () => {
    dialog.save = join(docsDir, 'x.msbak')
    await expect(svc.create({})).rejects.toMatchObject({ code: 'invalid_request' })
    dialog.folder = docsDir
    await expect(svc.chooseDestination()).rejects.toMatchObject({ code: 'invalid_request' })
  })

  it('maps filesystem errors to plain messages without paths', () => {
    for (const code of ['ENOSPC', 'EACCES', 'EBUSY', 'ENOENT', 'EWHATEVER']) {
      const e = toBackupError(Object.assign(new Error('C:\\Users\\secret\\x'), { code }))
      expect(e.message).not.toMatch(/Users|\\/)
    }
    expect(toBackupError(Object.assign(new Error('x'), { code: 'ENOSPC' })).code).toBe('disk_full')
  })
})

function rmSync1(p: string) {
  renameSync(p, `${p}.gone`)
}

describe('encryption', () => {
  it('encrypts with a password, rejects a wrong one and detects tampering', async () => {
    const pw = 'correct horse battery'
    const r = await manualBackup(pw, 'enc.msbak')
    expect(r.record.encrypted).toBe(true)
    const file = outFile('enc.msbak')
    const bytes = readFileSync(file)
    expect((await readHeader(file)).encrypted).toBe(true)
    expect(bytes.includes(Buffer.from('SQLite format 3'))).toBe(false)
    expect(bytes.includes(Buffer.from(pw))).toBe(false)
    expect(bytes.includes(Buffer.from('mindspace-backup'))).toBe(false)

    await expect(verifyBackupFile({ file, tmpDir: join(tmp.dir, 'a'), latestSchema: LATEST })).rejects.toMatchObject({ code: 'password_required' })
    await expect(verifyBackupFile({ file, password: 'wrong password!', tmpDir: join(tmp.dir, 'b'), latestSchema: LATEST })).rejects.toMatchObject({ code: 'wrong_password' })
    const ok = await verifyBackupFile({ file, password: pw, tmpDir: join(tmp.dir, 'c'), latestSchema: LATEST })
    expect(ok.manifest.encrypted).toBe(true)

    // Flip one ciphertext byte deep in the file.
    const bad = Buffer.from(bytes)
    bad[bad.length - 100] = ~bad[bad.length - 100]!
    writeFileSync(outFile('bad.msbak'), bad)
    await expect(verifyBackupFile({ file: outFile('bad.msbak'), password: pw, tmpDir: join(tmp.dir, 'd'), latestSchema: LATEST })).rejects.toBeInstanceOf(BackupError)
    // Truncation (drop the last chunk) fails authentication as well.
    writeFileSync(outFile('short.msbak'), bytes.subarray(0, bytes.length - 20))
    await expect(verifyBackupFile({ file: outFile('short.msbak'), password: pw, tmpDir: join(tmp.dir, 'e'), latestSchema: LATEST })).rejects.toBeInstanceOf(BackupError)
    // Header edits (e.g. KDF parameters) are authenticated too.
    const hdr = Buffer.from(bytes)
    hdr[12 + 16] = 12
    writeFileSync(outFile('hdr.msbak'), hdr)
    await expect(verifyBackupFile({ file: outFile('hdr.msbak'), password: pw, tmpDir: join(tmp.dir, 'f'), latestSchema: LATEST })).rejects.toBeInstanceOf(BackupError)
  })

  it('validates password length', async () => {
    dialog.save = outFile()
    await expect(svc.create({ password: 'short' })).rejects.toMatchObject({ code: 'invalid_request' })
  })
})

describe('untrusted archives', () => {
  const tamper = async (mutate: (b: Buffer) => Buffer, name = 'm.msbak') => {
    await manualBackup(undefined, 'good.msbak')
    writeFileSync(outFile(name), mutate(readFileSync(outFile('good.msbak'))))
    return outFile(name)
  }
  const verify = (file: string) => verifyBackupFile({ file, tmpDir: join(tmp.dir, `t-${Math.random().toString(36).slice(2)}`), latestSchema: LATEST })

  it('rejects files that are not backups, damaged or truncated', async () => {
    writeFileSync(join(tmp.dir, 'junk.msbak'), 'hello world, not a backup')
    await expect(verify(join(tmp.dir, 'junk.msbak'))).rejects.toMatchObject({ code: 'corrupt' })
    await expect(verify(await tamper((b) => b.subarray(0, b.length - 40)))).rejects.toBeInstanceOf(BackupError)
    await expect(verify(await tamper((b) => b.subarray(0, 100)))).rejects.toBeInstanceOf(BackupError)
  })

  it('rejects a flipped byte (checksum) and a modified trailer', async () => {
    await expect(verify(await tamper((b) => { const c = Buffer.from(b); c[Math.floor(c.length / 2)] = ~c[Math.floor(c.length / 2)]! & 0xff; return c }))).rejects.toMatchObject({ code: expect.stringMatching(/checksum|corrupt|invalid_manifest/) })
    await expect(verify(await tamper((b) => { const c = Buffer.from(b); c[c.length - 1] = ~c[c.length - 1]! & 0xff; return c }, 'm2.msbak'))).rejects.toMatchObject({ code: 'checksum' })
  })

  it('rejects an unsupported format version', async () => {
    const f = await tamper((b) => { const c = Buffer.from(b); c.writeUInt16BE(7, 8); return c })
    await expect(verify(f)).rejects.toMatchObject({ code: 'unsupported_format' })
  })

  it('rejects traversal, absolute, drive and backslash entry names', async () => {
    const src = join(tmp.dir, 'payload')
    writeFileSync(src, 'x')
    for (const name of ['../evil', '/etc/passwd', 'C:/Windows/x', 'data\\documents\\doc-x.pdf', 'data/documents/../../evil', 'data/documents/notes.exe', 'other/file']) {
      const dest = join(tmp.dir, `evil-${createHash('md5').update(name).digest('hex')}.msbak`)
      await writeContainer({ dest, manifest: Buffer.from('{}'), files: [{ name, source: src, size: 1 }] })
      await expect(openContainer(dest, undefined, join(tmp.dir, 'o'))).rejects.toMatchObject({ code: 'corrupt' })
    }
  })

  it('rejects a manifest that does not match the archive', async () => {
    const src = join(tmp.dir, 'payload')
    writeFileSync(src, 'x')
    const dest = join(tmp.dir, 'nomani.msbak')
    await writeContainer({ dest, manifest: Buffer.from('{"nope":1}'), files: [{ name: 'data/database/mindspace.sqlite3', source: src, size: 1 }] })
    await expect(verify(dest)).rejects.toMatchObject({ code: 'invalid_manifest' })
  })

  it('never writes through an existing symbolic link when extracting', async () => {
    await manualBackup()
    const container = await openContainer(outFile(), undefined, join(tmp.dir, 'c'))
    const entry = container.entries[0]!
    mkdirSync(join(tmp.dir, 'ex'))
    writeFileSync(join(tmp.dir, 'victim'), 'keep me')
    symlinkSync(join(tmp.dir, 'victim'), join(tmp.dir, 'ex', 'link'))
    await expect(extractEntry(container, entry, join(tmp.dir, 'ex', 'link'))).rejects.toMatchObject({ code: 'EEXIST' })
    expect(readFileSync(join(tmp.dir, 'victim'), 'utf8')).toBe('keep me')
  })
})

describe('restore', () => {
  async function prepare() {
    await manualBackup()
    const backedUp = counts(db)
    // Now change the live workspace so a restore is observable.
    db.prepare('DELETE FROM items').run()
    createWorkspaceService(db).createItem({ kind: 'note', title: 'Written after backup', body: '', url: '', tagLabels: [], projectId: null })
    for (const n of readdirSync(docsDir)) renameSync(join(docsDir, n), join(docsDir, `${n}.moved`))
    const sel = await svc.select({ recordId: svc.getStatus().records[0]!.id })
    return { backedUp, token: sel.token! }
  }

  it('inspects, requires a check first, stages, makes a verified safety backup and activates on restart', async () => {
    const { backedUp, token } = await prepare()
    const afterChange = counts(db)
    await expect(svc.restore({ token })).rejects.toMatchObject({ code: 'invalid_request' }) // not inspected yet
    const info = await svc.inspect({ token })
    expect(info.canRestore).toBe(true)
    expect(info.counts.notes).toBe(backedUp.items)
    expect(info.compatibilityNote).toMatch(/compatible/i)

    expect(await svc.restore({ token })).toEqual({ restarting: true })
    expect(restarts).toHaveLength(1)
    expect(maintenance).toEqual([true])
    expect(readJournal(userData)?.state).toBe('staged')
    // Live data is untouched until the restart.
    expect(counts(db)).toEqual(afterChange)
    // The safety backup exists, is tracked and verifies, and holds the state that is about to be replaced.
    const safety = svc.getStatus().records.find((r) => r.kind === 'safety')!
    // The test moved the document files away first, so the safety backup honestly carries a warning.
    expect(safety.verification).toBe('verified_with_warnings')
    expect(safety.counts?.notes).toBe(afterChange.items)

    // "Restart": close, then startup recovery runs before the database is opened.
    closeDatabase(db)
    const res = recoverPendingRestore(userData)
    expect(res.action).toBe('activated')
    db = open()
    expect(counts(db)).toEqual(backedUp)
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(readdirSync(docsDir).sort().filter((n) => !n.endsWith('.moved'))).toHaveLength(2)
    expect(existsSync(join(userData, 'restore-previous', res.action === 'activated' ? res.id : ''))).toBe(true) // kept until the app proved usable
    expect(svc.getStatus().records.find((r) => r.id === safety.id)!.present).toBe(true) // emergency backup still there
    completeRestore(userData)
    expect(readJournal(userData)?.state).toBe('completed')
    expect(rawFiles(join(userData, 'restore-previous'))).toEqual([])
    expect(svc.getStatus().records.find((r) => r.id === safety.id)!.present).toBe(true)
    expect(svc.getStatus().lastRestore?.state).toBe('completed')
  })

  it('can bring the pre-restore state back from the safety backup', async () => {
    const { token } = await prepare()
    const afterChange = counts(db)
    await svc.inspect({ token })
    await svc.restore({ token })
    closeDatabase(db)
    recoverPendingRestore(userData)
    completeRestore(userData)
    const safety = svc.getStatus().records.find((r) => r.kind === 'safety')!
    const sel = await svc.select({ recordId: safety.id })
    const info = await svc.inspect({ token: sel.token! })
    expect(info.counts.notes).toBe(afterChange.items)
  })

  it('rolls back when activation fails part way and leaves the current data in place', async () => {
    const { token } = await prepare()
    const afterChange = counts(db)
    await svc.inspect({ token })
    await svc.restore({ token })
    closeDatabase(db)
    const res = recoverPendingRestore(userData, {
      afterStep: (s) => {
        if (s === 'installed:db') throw new Error('disk exploded')
      }
    })
    expect(res.action).toBe('rolled_back')
    expect(readJournal(userData)?.state).toBe('rolled_back')
    db = open()
    expect(counts(db).items).toBe(afterChange.items)
    expect(counts(db).titles).toBe(afterChange.titles)
    expect(readdirSync(docsDir).filter((n) => n.endsWith('.moved')).length).toBe(2) // original folder is back as it was
  })

  it('recovers from a crash between moving the old data aside and installing the new', async () => {
    const { token } = await prepare()
    const afterChange = counts(db)
    await svc.inspect({ token })
    await svc.restore({ token })
    closeDatabase(db)
    const j = readJournal(userData)!
    // Reproduce what a process killed mid-activation leaves on disk.
    const prev = join(userData, 'restore-previous', j.id)
    mkdirSync(prev, { recursive: true })
    renameSync(join(userData, 'mindspace.sqlite3'), join(prev, 'mindspace.sqlite3'))
    for (const s of ['-wal', '-shm']) if (existsSync(join(userData, `mindspace.sqlite3${s}`))) renameSync(join(userData, `mindspace.sqlite3${s}`), join(prev, `mindspace.sqlite3${s}`))
    renameSync(docsDir, join(prev, 'documents'))
    writeFileSync(join(userData, 'restore-journal.json'), JSON.stringify({ ...j, state: 'activating' }))
    expect(existsSync(join(userData, 'mindspace.sqlite3'))).toBe(false)
    expect(recoverPendingRestore(userData).action).toBe('rolled_back')
    db = open()
    expect(counts(db).titles).toBe(afterChange.titles)
    expect(readdirSync(docsDir).filter((n) => n.endsWith('.moved')).length).toBe(2)
  })

  it('undoes an activated restore whose database will not open', async () => {
    const { token } = await prepare()
    const afterChange = counts(db)
    await svc.inspect({ token })
    await svc.restore({ token })
    closeDatabase(db)
    expect(recoverPendingRestore(userData).action).toBe('activated')
    expect(rollbackActivated(userData)).toBe(true)
    db = open()
    expect(counts(db).titles).toBe(afterChange.titles)
    expect(readJournal(userData)?.state).toBe('rolled_back')
  })

  it('applies an interrupted but fully staged restore on the next start', async () => {
    const { token, backedUp } = await prepare()
    await svc.inspect({ token })
    await svc.restore({ token })
    closeDatabase(db) // app killed after staging, before the restart ran
    expect(recoverPendingRestore(userData).action).toBe('activated')
    db = open()
    expect(counts(db)).toEqual(backedUp)
  })

  it('rejects corrupt and incompatible backups without changing anything', async () => {
    await manualBackup(undefined, 'good.msbak')
    const afterChange = counts(db)
    const bytes = readFileSync(outFile('good.msbak'))
    const bad = Buffer.from(bytes)
    bad[Math.floor(bad.length / 2)] = ~bad[Math.floor(bad.length / 2)]! & 0xff
    writeFileSync(outFile('bad.msbak'), bad)
    dialog.open = outFile('bad.msbak')
    const sel = await svc.select({})
    await expect(svc.inspect({ token: sel.token! })).rejects.toBeInstanceOf(BackupError)
    await expect(svc.restore({ token: sel.token! })).rejects.toMatchObject({ code: 'invalid_request' })
    expect(readJournal(userData)).toBeNull()
    expect(counts(db)).toEqual(afterChange)

    // A backup from a newer database version than this app knows is refused.
    const older = makeService(LATEST - 1)
    dialog.open = outFile('good.msbak')
    const sel2 = await older.select({})
    const info = await older.inspect({ token: sel2.token! })
    expect(info.compatible).toBe(false)
    expect(info.canRestore).toBe(false)
    await expect(older.restore({ token: sel2.token! })).rejects.toMatchObject({ code: 'incompatible_schema' })
    expect(readJournal(userData)).toBeNull()
  })

  it('Phase 9: a database naming a document file outside the documents folder is not accepted from a backup', async () => {
    const { assertDatabaseHealthy } = await import('../../src/main/backup/snapshot')
    db.prepare("UPDATE documents SET stored_name = '../../outside.txt' WHERE id = (SELECT id FROM documents LIMIT 1)").run()
    // Structure is fine, so checksums/integrity alone would accept it ...
    expect(() => assertDatabaseHealthy(db)).not.toThrow()
    // ... but a database that came out of a backup is checked for benign contents too.
    expect(() => assertDatabaseHealthy(db, { untrusted: true })).toThrowError(/not allowed/)
    // Creating a backup verifies the result the same way, so such a file is never written as "verified".
    dialog.save = outFile('hostile.msbak')
    await expect(svc.create({})).rejects.toMatchObject({ code: 'database_integrity' })
    expect(readJournal(userData)).toBeNull()
  })

  it('asks for a password, rejects a wrong one and restores an encrypted backup', async () => {
    const pw = 'long enough pw'
    await manualBackup(pw, 'enc.msbak')
    const backedUp = counts(db)
    db.prepare('DELETE FROM items').run()
    dialog.open = outFile('enc.msbak')
    const sel = await svc.select({})
    expect(sel.needsPassword).toBe(true)
    await expect(svc.inspect({ token: sel.token! })).rejects.toMatchObject({ code: 'password_required' })
    await expect(svc.inspect({ token: sel.token!, password: 'definitely wrong' })).rejects.toMatchObject({ code: 'wrong_password' })
    await svc.inspect({ token: sel.token!, password: pw })
    await svc.restore({ token: sel.token! })
    closeDatabase(db)
    recoverPendingRestore(userData)
    db = open()
    expect(counts(db)).toEqual(backedUp)
  })

  it('keeps the current data and re-enables writes when the safety backup cannot be made', async () => {
    const { token } = await prepare()
    const afterChange = counts(db)
    await svc.inspect({ token })
    writeFileSync(join(userData, 'backups'), 'blocks the folder') // safety folder cannot be created
    await expect(svc.restore({ token })).rejects.toBeInstanceOf(BackupError)
    expect(maintenance).toEqual([true, false])
    expect(restarts).toHaveLength(0)
    expect(readJournal(userData)).toBeNull()
    expect(rawFiles(join(userData, 'restore-staging'))).toEqual([])
    expect(counts(db)).toEqual(afterChange)
  })

  it('refuses a second restore while one is pending', async () => {
    const { token } = await prepare()
    await svc.inspect({ token })
    await svc.restore({ token })
    const info = { userData, id: 'a'.repeat(32) }
    expect(() => armRestore(info.userData, info.id)).toThrow(BackupError)
    void stageRestore
  })
})

describe('retention and scheduling', () => {
  const day = 24 * 3600 * 1000

  it('keeps manual exports and safety backups, removes only old tracked automatic backups', async () => {
    await manualBackup(undefined, 'manual.msbak')
    svc.setConfig({ keepAuto: 2 })
    const autoDir = join(userData, 'backups', 'auto')
    for (let i = 0; i < 4; i++) {
      clock += day
      await svc.createAutoNow()
    }
    // A look-alike file the system does not track must survive.
    writeFileSync(join(autoDir, 'mindspace-auto_2020-01-01_000000.msbak'), 'not mine')
    writeFileSync(join(autoDir, 'notes.txt'), 'user file')
    clock += day
    await svc.createAutoNow()
    const st = svc.getStatus()
    const autos = st.records.filter((r) => r.kind === 'auto')
    expect(autos).toHaveLength(2)
    expect(autos.every((r) => r.verification === 'verified')).toBe(true)
    expect(st.records.filter((r) => r.kind === 'manual')).toHaveLength(1)
    expect(existsSync(outFile('manual.msbak'))).toBe(true)
    expect(readFileSync(join(autoDir, 'mindspace-auto_2020-01-01_000000.msbak'), 'utf8')).toBe('not mine')
    expect(existsSync(join(autoDir, 'notes.txt'))).toBe(true)
    expect(readdirSync(autoDir).filter((n) => n.startsWith('mindspace-auto_2026'))).toHaveLength(2)
  })

  it('never deletes the only verified automatic backup and ignores failed records', async () => {
    svc.setConfig({ keepAuto: 1 })
    await svc.createAutoNow()
    svc._store.update((s) => void s.records.push({ ...s.records[0]!, id: 'f'.repeat(32), file: join(userData, 'backups', 'auto', 'ghost.msbak'), verification: 'failed', createdAt: '2030-01-01T00:00:00Z' }))
    clock += day
    await svc.createAutoNow()
    const autos = svc.getStatus().records.filter((r) => r.kind === 'auto')
    expect(autos).toHaveLength(1)
    expect(autos[0]!.present).toBe(true)
    expect(svc.getStatus().lastSuccess?.id).toBe(autos[0]!.id)
  })

  it('runs only when due, never overlaps, and reports the next run', async () => {
    svc.setConfig({ autoEnabled: true, frequency: 'daily' })
    const [a, b] = await Promise.all([svc.tick(), svc.tick()])
    expect([a, b].sort()).toEqual(['ran', 'skipped'])
    expect(svc.getStatus().records.filter((r) => r.kind === 'auto')).toHaveLength(1)
    expect(await svc.tick()).toBe('skipped') // not due again yet
    expect(Date.parse(svc.getStatus().nextAutoAt!)).toBe(clock + day)
    clock += day + 1
    expect(await svc.tick()).toBe('ran')
    svc.setConfig({ autoEnabled: false })
    clock += 10 * day
    expect(await svc.tick()).toBe('skipped')
    expect(svc.getStatus().nextAutoAt).toBeNull()
  })

  it('catches up with one backup after a missed period and honours the weekly choice', async () => {
    svc.setConfig({ autoEnabled: true, frequency: 'weekly' })
    expect(await svc.tick()).toBe('ran')
    clock += 3 * day
    expect(await svc.tick()).toBe('skipped')
    clock += 30 * day
    expect(await svc.tick()).toBe('ran')
    expect(svc.getStatus().records.filter((r) => r.kind === 'auto')).toHaveLength(2)
  })

  it('does not start two timers', () => {
    vi.useFakeTimers()
    const spy = vi.spyOn(globalThis, 'setInterval')
    svc.startScheduler()
    svc.startScheduler()
    expect(spy).toHaveBeenCalledTimes(1)
    svc.stopScheduler()
    svc.startScheduler()
    expect(spy).toHaveBeenCalledTimes(2)
    svc.stopScheduler()
  })

  it('reports an unavailable destination and backs off', async () => {
    const folder = join(tmp.dir, 'usb')
    mkdirSync(folder)
    dialog.folder = folder
    expect((await svc.chooseDestination())?.destination.isDefault).toBe(false)
    svc.setConfig({ autoEnabled: true })
    await rm(folder, { recursive: true })
    await expect(svc.createAutoNow()).rejects.toMatchObject({ code: 'destination_unavailable' })
    const st = svc.getStatus()
    expect(st.lastAutoFailure?.message).toMatch(/not available/)
    expect(st.destination.available).toBe(false)
    expect(st.records).toEqual([])
    // A failed attempt delays the next try instead of hammering.
    expect(Date.parse(st.nextAutoAt!)).toBeGreaterThanOrEqual(clock + 3600 * 1000)
    expect(await svc.tick()).toBe('skipped')
  })

  it('cleans interrupted leftovers only inside its own folders', async () => {
    const autoDir = join(userData, 'backups', 'auto')
    mkdirSync(autoDir, { recursive: true })
    writeFileSync(join(autoDir, '.mindspace-auto_x.msbak.abcd1234.part'), 'half')
    writeFileSync(join(autoDir, 'mine.txt'), 'user')
    mkdirSync(join(userData, 'backup-tmp', 'create-old'), { recursive: true })
    await svc.cleanupLeftovers()
    expect(readdirSync(autoDir)).toEqual(['mine.txt'])
    expect(existsSync(join(userData, 'backup-tmp'))).toBe(false)
    expect(existsSync(docsDir)).toBe(true)
  })
})

describe('IPC boundary', () => {
  const handlers = backupHandlers(() => svc)
  const call = (channel: string, ...args: unknown[]) => backupResult(() => handlers[channel]!(...args))

  it('validates every payload and refuses unknown keys such as paths', async () => {
    const C = IpcChannel
    for (const [ch, payload] of [
      [C.backupSelect, { file: 'C:\\Windows\\System32\\config' }],
      [C.backupSelect, { recordId: '../../x' }],
      [C.backupInspect, { token: 'nope' }],
      [C.backupInspect, { token: 'a'.repeat(32), password: 'x'.repeat(1000) }],
      [C.backupRestore, { token: 'a'.repeat(32), path: 'C:\\x' }],
      [C.backupConfig, { keepAuto: 0 }],
      [C.backupConfig, { keepAuto: 9999 }],
      [C.backupConfig, { destination: 'C:\\x' }],
      [C.backupCreate, { password: 5, path: 'x' }],
      [C.backupForget, 42]
    ] as [string, unknown][]) {
      const r = await call(ch, payload)
      expect(r.ok, `${ch} ${JSON.stringify(payload)}`).toBe(false)
    }
  })

  it('returns plain messages, never stack traces or paths', async () => {
    const r = await call(IpcChannel.backupInspect, { token: 'b'.repeat(32) })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.message).not.toMatch(/\bat \S+ \(|\.ts:|\\|\/home|\/tmp/)
  })

  it('does not log passwords or secrets', async () => {
    const logs: string[] = []
    const spies = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation((...a) => void logs.push(a.join(' '))))
    const pw = 'my-very-secret-pw'
    await manualBackup(pw)
    await call(IpcChannel.backupInspect, { token: 'c'.repeat(32), password: pw })
    spies.forEach((s) => s.mockRestore())
    expect(logs.join('\n')).not.toContain(pw)
    expect(logs.join('\n')).not.toContain(SECRET)
  })

  it('status exposes no filesystem paths', async () => {
    await manualBackup()
    const s = JSON.stringify(svc.getStatus())
    expect(s).not.toContain(tmp.dir)
    expect(s).not.toContain(SECRET)
  })
})
