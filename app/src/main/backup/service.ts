/**
 * Orchestrates backups for the running app: one operation at a time, native
 * dialogs only through injected functions (so the renderer never supplies a
 * path), tracked records, retention, an in-session scheduler, and the staged
 * restore. Every failure is a BackupError with a message safe to show.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import type { Database } from 'better-sqlite3'
import {
  BACKUP_EXTENSION,
  BACKUP_PASSWORD_MAX,
  BACKUP_PASSWORD_MIN,
  type BackupConfig,
  type BackupKind,
  type BackupProgress,
  type BackupRecord,
  type BackupStatus,
  type CreateResult,
  type Inspection,
  type LastRestore,
  type SelectResult,
  type VerificationStatus
} from '@shared/backup'
import { readHeader } from './container'
import { createBackupFile, defaultFileName, type Created } from './create'
import { BackupError, toBackupError } from './errors'
import { toInspection, verifyBackupFile } from './inspect'
import { armRestore, clearJournal, discardStaging, readJournal, stageRestore } from './restore'
import { createStateStore, type StoredRecord } from './state'

export interface BackupDialogs {
  /** Native save dialog. Null when cancelled. */
  saveBackup(defaultName: string): Promise<string | null>
  openBackup(): Promise<string | null>
  chooseFolder(): Promise<string | null>
}

export interface BackupServiceDeps {
  getDb: () => Database
  userData: string
  documentsDir: string
  appVersion: string
  latestSchema: number
  dialogs: BackupDialogs
  requestRestart: () => void
  setMaintenance: (on: boolean) => void
  emit?: (p: BackupProgress) => void
  now?: () => Date
  /** Scheduler poll interval; the due check itself uses the configured frequency. */
  tickMs?: number
}

const DAY = 24 * 3600 * 1000
const RETRY_AFTER_FAILURE = 3600 * 1000
const TOKEN_TTL = 30 * 60 * 1000
const AUTO_NAME = /^mindspace-auto_[0-9_-]+( \(\d+\))?\.msbak$/
const SAFETY_NAME = /^mindspace-safety_[0-9_-]+( \(\d+\))?\.msbak$/
const SAFETY_KEEP = 3
const OK = new Set<VerificationStatus>(['verified', 'verified_with_warnings'])

interface Candidate {
  file: string
  recordId: string | null
  password: string | undefined
  inspectedOk: boolean
  expires: number
}

export function createBackupService(deps: BackupServiceDeps) {
  const now = deps.now ?? (() => new Date())
  const tmpRoot = join(deps.userData, 'backup-tmp')
  const defaultAutoDir = join(deps.userData, 'backups', 'auto')
  const safetyDir = join(deps.userData, 'backups', 'safety')
  const store = createStateStore(join(deps.userData, 'backup-state.json'))
  const candidates = new Map<string, Candidate>()
  let busy: null | 'create' | 'verify' | 'restore' = null
  let timer: NodeJS.Timeout | null = null
  let firstTick: NodeJS.Timeout | null = null

  const emit = (operation: BackupProgress['operation']) => (phase: string, done?: number, total?: number) =>
    deps.emit?.({ operation, phase, ...(done !== undefined ? { done } : {}), ...(total !== undefined ? { total } : {}) })

  async function exclusive<T>(op: NonNullable<typeof busy>, fn: () => Promise<T>): Promise<T> {
    if (busy) throw new BackupError('busy', 'Another backup operation is running. Wait for it to finish.')
    busy = op
    try {
      return await fn()
    } finally {
      busy = null
    }
  }

  const checkPassword = (pw: string | undefined): string | undefined => {
    if (pw === undefined || pw === '') return undefined
    if (typeof pw !== 'string' || pw.length < BACKUP_PASSWORD_MIN || pw.length > BACKUP_PASSWORD_MAX) {
      throw new BackupError('invalid_request', `The password must be ${BACKUP_PASSWORD_MIN}–${BACKUP_PASSWORD_MAX} characters.`)
    }
    return pw
  }

  /** Never write backups into the live data folders. */
  const assertSafeDestination = (dir: string) => {
    const d = resolve(dir)
    const bad = [deps.documentsDir, join(deps.userData, 'restore-staging'), join(deps.userData, 'restore-previous'), tmpRoot].map((p) => resolve(p))
    if (bad.some((p) => d === p || d.startsWith(p + sep))) throw new BackupError('invalid_request', 'Choose a different folder: this one holds MINDSPACE’s working data.')
  }

  const autoDir = () => store.get().autoDir ?? defaultAutoDir
  const toStored = (c: Created, kind: BackupKind, id: string): StoredRecord => ({
    id,
    kind,
    file: c.file,
    createdAt: c.manifest.createdAt,
    bytes: c.bytes,
    encrypted: c.manifest.encrypted,
    appVersion: c.manifest.app.version,
    schemaVersion: c.manifest.database.schemaVersion,
    formatVersion: c.manifest.formatVersion,
    verification: c.report.issues.length ? 'verified_with_warnings' : 'verified',
    verifiedAt: now().toISOString(),
    counts: c.manifest.counts
  })

  async function run(kind: BackupKind, destFile: string, password: string | undefined, op: 'create' | 'restore' = 'create'): Promise<{ record: StoredRecord; renamed: boolean }> {
    assertSafeDestination(dirname(destFile))
    await mkdir(tmpRoot, { recursive: true })
    const created = await createBackupFile(
      { db: deps.getDb(), documentsDir: deps.documentsDir, tmpRoot, appVersion: deps.appVersion, latestSchema: deps.latestSchema, now, onProgress: emit(op) },
      { kind, destFile, password }
    )
    const record = toStored(created, kind, randomBytes(16).toString('hex'))
    store.update((s) => void s.records.push(record))
    return { record, renamed: created.renamed }
  }

  // ------------------------------------------------------------ retention

  /** Verified automatic backups beyond the keep count, newest first kept. Manual and safety backups are never touched here. */
  function retentionPlan(): { keep: StoredRecord[]; remove: StoredRecord[] } {
    const s = store.get()
    const autos = s.records.filter((r) => r.kind === 'auto' && OK.has(r.verification) && existsSync(r.file)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return { keep: autos.slice(0, s.config.keepAuto), remove: autos.slice(s.config.keepAuto) }
  }

  async function applyRetention(): Promise<number> {
    const { remove } = retentionPlan()
    const gone = new Set<string>()
    for (const r of remove) {
      // Only files this system created and tracks, by name pattern, are ever deleted.
      if (!AUTO_NAME.test(basename(r.file))) continue
      try {
        await unlink(r.file)
        gone.add(r.id)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') gone.add(r.id)
      }
    }
    // Safety backups: keep the newest few.
    const safeties = store.get().records.filter((r) => r.kind === 'safety' && OK.has(r.verification)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    for (const r of safeties.slice(SAFETY_KEEP)) {
      if (!SAFETY_NAME.test(basename(r.file))) continue
      try {
        await unlink(r.file)
        gone.add(r.id)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') gone.add(r.id)
      }
    }
    // Forget automatic backups that failed verification or whose file is gone; they never count as backups.
    for (const r of store.get().records) if (r.kind === 'auto' && (!OK.has(r.verification) || !existsSync(r.file))) gone.add(r.id)
    if (gone.size) store.update((s) => void (s.records = s.records.filter((r) => !gone.has(r.id))))
    return gone.size
  }

  // ------------------------------------------------------------ status

  const folderLabel = (dir: string) => dir.split(/[\\/]+/).filter(Boolean).slice(-2).join(' › ')

  function nextAutoAt(): string | null {
    const s = store.get()
    if (!s.config.autoEnabled) return null
    const interval = s.config.frequency === 'weekly' ? 7 * DAY : DAY
    const last = s.records.filter((r) => r.kind === 'auto' && OK.has(r.verification)).map((r) => Date.parse(r.createdAt)).sort((a, b) => b - a)[0]
    let at = last !== undefined ? last + interval : now().getTime()
    if (s.lastAuto && !s.lastAuto.ok) at = Math.max(at, Date.parse(s.lastAuto.at) + RETRY_AFTER_FAILURE)
    return new Date(at).toISOString()
  }

  function lastRestore(): LastRestore | null {
    const j = readJournal(deps.userData)
    if (!j) return null
    const state = j.state === 'completed' ? 'completed' : j.state === 'rolled_back' ? 'rolled_back' : j.state === 'failed' ? 'failed' : 'pending'
    return { state, at: j.updatedAt, message: j.message }
  }

  function status(): BackupStatus {
    const s = store.get()
    const removable = new Set(retentionPlan().remove.map((r) => r.id))
    const records: BackupRecord[] = [...s.records]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((r) => ({
        id: r.id,
        kind: r.kind,
        fileName: basename(r.file),
        folder: folderLabel(dirname(r.file)),
        createdAt: r.createdAt,
        bytes: r.bytes,
        encrypted: r.encrypted,
        appVersion: r.appVersion,
        schemaVersion: r.schemaVersion,
        formatVersion: r.formatVersion,
        verification: r.verification,
        verifiedAt: r.verifiedAt,
        counts: r.counts,
        present: existsSync(r.file),
        removable: removable.has(r.id)
      }))
    const dir = autoDir()
    return {
      config: s.config,
      destination: { isDefault: s.autoDir === null, label: s.autoDir === null ? 'MINDSPACE data › backups › auto' : folderLabel(dir), available: s.autoDir === null || existsSync(dir) },
      records,
      lastSuccess: records.find((r) => OK.has(r.verification) && r.present) ?? null,
      lastAutoFailure: s.lastAuto && !s.lastAuto.ok ? { at: s.lastAuto.at, message: s.lastAuto.message } : null,
      nextAutoAt: nextAutoAt(),
      busy,
      lastRestore: lastRestore(),
      scheduler: { runsOnlyWhileOpen: true }
    }
  }

  // ------------------------------------------------------------ operations

  async function create(input: { password?: string }): Promise<CreateResult> {
    const password = checkPassword(input?.password)
    return exclusive('create', async () => {
      const picked = await deps.dialogs.saveBackup(defaultFileName('manual', now()))
      if (!picked) return { cancelled: true }
      const dest = picked.toLowerCase().endsWith(`.${BACKUP_EXTENSION}`) ? picked : `${picked}.${BACKUP_EXTENSION}`
      const { record, renamed } = await run('manual', dest, password)
      return { cancelled: false, renamed, record: status().records.find((r) => r.id === record.id)! }
    })
  }

  async function createAuto(trigger: 'scheduled' | 'manual'): Promise<CreateResult> {
    return exclusive('create', async () => {
      try {
        const dir = autoDir()
        if (store.get().autoDir && !existsSync(dir)) throw new BackupError('destination_unavailable', 'The backup folder is not available (is the drive connected?).')
        const { record, renamed } = await run('auto', join(dir, defaultFileName('auto', now())), undefined)
        store.update((s) => void (s.lastAuto = { at: now().toISOString(), ok: true, message: '' }))
        await applyRetention()
        return { cancelled: false, renamed, record: status().records.find((r) => r.id === record.id)! }
      } catch (err) {
        const e = toBackupError(err)
        store.update((s) => void (s.lastAuto = { at: now().toISOString(), ok: false, message: e.message }))
        throw e
      } finally {
        void trigger
      }
    })
  }

  function newToken(c: Omit<Candidate, 'expires'>): string {
    for (const [t, v] of candidates) if (v.expires < Date.now()) candidates.delete(t)
    while (candidates.size >= 5) candidates.delete(candidates.keys().next().value as string)
    const token = randomBytes(16).toString('hex')
    candidates.set(token, { ...c, expires: Date.now() + TOKEN_TTL })
    return token
  }

  async function select(input: { recordId?: string }): Promise<SelectResult> {
    let file: string | null
    let recordId: string | null = null
    if (input?.recordId !== undefined) {
      const r = store.get().records.find((x) => x.id === input.recordId)
      if (!r) throw new BackupError('invalid_request', 'That backup is not in the list.')
      if (!existsSync(r.file)) throw new BackupError('destination_unavailable', 'The backup file is no longer there.')
      file = r.file
      recordId = r.id
    } else {
      file = await deps.dialogs.openBackup()
    }
    if (!file) return { cancelled: true, token: null, encrypted: false, needsPassword: false }
    const header = await readHeader(file).catch((e) => {
      throw toBackupError(e)
    })
    const token = newToken({ file, recordId, password: undefined, inspectedOk: false })
    return { cancelled: false, token, encrypted: header.encrypted, needsPassword: header.encrypted }
  }

  const candidate = (token: unknown): Candidate => {
    const c = typeof token === 'string' ? candidates.get(token) : undefined
    if (!c || c.expires < Date.now()) throw new BackupError('invalid_request', 'This selection expired. Choose the backup again.')
    return c
  }

  const markRecord = (id: string | null, v: VerificationStatus) => {
    if (!id) return
    store.update((s) => {
      const r = s.records.find((x) => x.id === id)
      if (r) {
        r.verification = v
        r.verifiedAt = now().toISOString()
      }
    })
  }

  async function inspect(input: { token: string; password?: string }): Promise<Inspection> {
    const c = candidate(input?.token)
    const password = input.password === undefined || input.password === '' ? undefined : input.password
    if (password !== undefined && (typeof password !== 'string' || password.length > BACKUP_PASSWORD_MAX)) throw new BackupError('invalid_request', 'The password is not valid.')
    return exclusive('verify', async () => {
      const tmp = join(tmpRoot, `inspect-${randomUUID()}`)
      try {
        const report = await verifyBackupFile({ file: c.file, password, tmpDir: tmp, latestSchema: deps.latestSchema, onProgress: (d, t) => emit('verify')('verify', d, t) })
        c.password = password
        c.inspectedOk = true
        markRecord(c.recordId, report.issues.length ? 'verified_with_warnings' : 'verified')
        return toInspection(report, input.token)
      } catch (err) {
        const e = toBackupError(err)
        c.inspectedOk = false
        if (!['password_required', 'wrong_password', 'busy', 'internal', 'locked', 'permission'].includes(e.code)) markRecord(c.recordId, 'failed')
        throw e
      } finally {
        await rm(tmp, { recursive: true, force: true }).catch(() => undefined)
      }
    })
  }

  async function verifyRecord(input: { recordId: string; password?: string }): Promise<BackupRecord> {
    const sel = await select({ recordId: input?.recordId })
    await inspect({ token: sel.token!, ...(input.password ? { password: input.password } : {}) })
    candidates.delete(sel.token!)
    return status().records.find((r) => r.id === input.recordId)!
  }

  async function restore(input: { token: string }): Promise<{ restarting: boolean }> {
    const c = candidate(input?.token)
    if (!c.inspectedOk) throw new BackupError('invalid_request', 'Check the backup first, then confirm the restore.')
    return exclusive('restore', async () => {
      const id = randomBytes(16).toString('hex')
      const tmp = join(tmpRoot, `restore-${id}`)
      const progress = emit('restore')
      let blocked = false
      try {
        progress('validate')
        const report = await verifyBackupFile({ file: c.file, password: c.password, tmpDir: tmp, latestSchema: deps.latestSchema, onProgress: (d, t) => progress('validate', d, t) })
        if (!report.compatible || !report.databaseOk) throw new BackupError('incompatible_schema', report.compatibilityNote)

        progress('stage')
        await stageRestore({ userData: deps.userData, id, report })

        // From here on no renderer write is accepted, so the safety backup is the exact state being replaced.
        deps.setMaintenance(true)
        blocked = true
        progress('safety')
        await mkdir(safetyDir, { recursive: true })
        const safety = await run('safety', join(safetyDir, defaultFileName('safety', now())), undefined, 'restore')
        void safety

        progress('arm')
        armRestore(deps.userData, id, now())
        await applyRetention().catch(() => undefined)
        deps.requestRestart()
        return { restarting: true }
      } catch (err) {
        discardStaging(deps.userData, id)
        if (blocked) deps.setMaintenance(false)
        throw toBackupError(err)
      } finally {
        await rm(tmp, { recursive: true, force: true }).catch(() => undefined)
        c.password = undefined
        candidates.delete(input.token)
      }
    })
  }

  async function chooseDestination(): Promise<BackupStatus | null> {
    const dir = await deps.dialogs.chooseFolder()
    if (!dir) return null
    assertSafeDestination(dir)
    try {
      await mkdir(dir, { recursive: true })
      const probe = join(dir, `.mindspace-write-test-${randomBytes(4).toString('hex')}`)
      await writeFile(probe, 'x', { flag: 'wx' })
      await unlink(probe)
    } catch (err) {
      throw toBackupError(err)
    }
    store.update((s) => void (s.autoDir = resolve(dir)))
    return status()
  }

  function setConfig(patch: Partial<BackupConfig>): BackupStatus {
    store.update((s) => {
      if (patch.autoEnabled !== undefined) s.config.autoEnabled = patch.autoEnabled
      if (patch.frequency !== undefined) s.config.frequency = patch.frequency
      if (patch.keepAuto !== undefined) s.config.keepAuto = patch.keepAuto
    })
    return status()
  }

  // ------------------------------------------------------------ scheduler

  /** Runs one automatic backup if it is due and nothing else is running. */
  async function tick(): Promise<'ran' | 'skipped'> {
    const s = store.get()
    if (!s.config.autoEnabled || busy) return 'skipped'
    const due = nextAutoAt()
    if (!due || Date.parse(due) > now().getTime()) return 'skipped'
    try {
      await createAuto('scheduled')
    } catch {
      /* recorded in lastAuto */
    }
    return 'ran'
  }

  function startScheduler(): void {
    if (timer) return // never two timers
    timer = setInterval(() => void tick(), deps.tickMs ?? 15 * 60 * 1000)
    timer.unref()
    firstTick = setTimeout(() => void tick(), 30_000)
    firstTick.unref()
  }

  function stopScheduler(): void {
    if (timer) clearInterval(timer)
    if (firstTick) clearTimeout(firstTick)
    timer = null
    firstTick = null
  }

  /** Removes leftovers of interrupted runs, only inside folders this system owns. */
  async function cleanupLeftovers(): Promise<void> {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined)
    for (const dir of [defaultAutoDir, safetyDir]) {
      try {
        for (const n of await readdir(dir)) if (/^\.mindspace-(auto|safety)_.*\.part$/.test(n) || /^\.mindspace-.*\.part$/.test(n)) await unlink(join(dir, n)).catch(() => undefined)
      } catch {
        /* folder not created yet */
      }
    }
  }

  return {
    getStatus: status,
    setConfig,
    create,
    createAutoNow: () => createAuto('manual'),
    chooseDestination,
    resetDestination: () => {
      store.update((s) => void (s.autoDir = null))
      return status()
    },
    select,
    inspect,
    verifyRecord,
    restore,
    forget: (id: string) => {
      store.update((s) => void (s.records = s.records.filter((r) => r.id !== id)))
      return status()
    },
    dismissLastRestore: () => {
      clearJournal(deps.userData)
      return status()
    },
    startScheduler,
    stopScheduler,
    tick,
    cleanupLeftovers,
    retentionPlan,
    isBusy: () => busy !== null,
    /** For tests and diagnostics only. */
    _store: store
  }
}
export type BackupService = ReturnType<typeof createBackupService>
