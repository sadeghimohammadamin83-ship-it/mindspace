/**
 * Phase 8: backup, restore and recovery. Types shared by main, preload and
 * renderer. Nothing here carries a file path from the renderer to main: the
 * main process opens the native dialogs and keeps the chosen files behind
 * short-lived tokens. Passwords travel renderer → main only, once per call,
 * and are never stored, logged or returned.
 */
import type { DataResult } from './ipc'

export const BACKUP_EXTENSION = 'msbak'
export const BACKUP_FORMAT_VERSION = 1
export const BACKUP_PASSWORD_MIN = 8
export const BACKUP_PASSWORD_MAX = 256
export const RETENTION_MIN = 1
export const RETENTION_MAX = 60
export const RETENTION_DEFAULT = 7

export type BackupKind = 'manual' | 'auto' | 'safety'
export type BackupFrequency = 'daily' | 'weekly'

export type BackupErrorCode =
  | 'busy'
  | 'cancelled'
  | 'disk_full'
  | 'permission'
  | 'locked'
  | 'destination_unavailable'
  | 'corrupt'
  | 'checksum'
  | 'invalid_manifest'
  | 'unsupported_format'
  | 'incompatible_schema'
  | 'wrong_password'
  | 'password_required'
  | 'missing_files'
  | 'database_integrity'
  | 'too_large'
  | 'invalid_request'
  | 'unavailable'
  | 'interrupted'
  | 'internal'

export type BackupProgress = { operation: 'create' | 'verify' | 'restore'; phase: string; done?: number; total?: number }

export interface BackupCounts {
  notes: number
  projects: number
  tasks: number
  decisions: number
  tags: number
  documents: number
  conversations: number
  semanticChunks: number
}

export interface BackupConfig {
  autoEnabled: boolean
  frequency: BackupFrequency
  /** Number of automatic backups kept. Manual exports and safety backups are never counted or removed by this rule. */
  keepAuto: number
}

/** Where automatic backups go, shown without the full path. */
export interface AutoDestination {
  isDefault: boolean
  /** Last two folder names only. */
  label: string
  available: boolean
}

export type VerificationStatus = 'verified' | 'verified_with_warnings' | 'failed' | 'unverified'

export interface BackupRecord {
  id: string
  kind: BackupKind
  fileName: string
  folder: string
  createdAt: string
  bytes: number
  encrypted: boolean
  appVersion: string
  schemaVersion: number
  formatVersion: number
  verification: VerificationStatus
  verifiedAt: string | null
  counts: BackupCounts | null
  /** The file is still where the app put it. */
  present: boolean
  /** Automatic backups the next cleanup may remove. */
  removable: boolean
}

export type RestoreOutcomeState = 'pending' | 'completed' | 'rolled_back' | 'failed'

export interface LastRestore {
  state: RestoreOutcomeState
  at: string
  /** Plain-language note, no paths. */
  message: string
}

export interface BackupStatus {
  config: BackupConfig
  destination: AutoDestination
  records: BackupRecord[]
  lastSuccess: BackupRecord | null
  lastAutoFailure: { at: string; message: string } | null
  nextAutoAt: string | null
  busy: null | 'create' | 'verify' | 'restore'
  lastRestore: LastRestore | null
  /** Honest scope statement the UI shows verbatim. */
  scheduler: { runsOnlyWhileOpen: true }
}

export interface Issue {
  severity: 'error' | 'warning'
  code: string
  message: string
}

export interface Inspection {
  token: string
  encrypted: boolean
  formatVersion: number
  createdAt: string
  appVersion: string
  schemaVersion: number
  kind: BackupKind
  platform: string
  bytes: number
  counts: BackupCounts
  documentFiles: number
  components: { id: string; included: boolean; note: string }[]
  /** Archive integrity: structure, manifest, sizes, checksums, authentication. */
  archiveOk: boolean
  /** Database snapshot opens on its own and passes integrity checks. */
  databaseOk: boolean
  issues: Issue[]
  compatible: boolean
  compatibilityNote: string
  canRestore: boolean
}

export type CreateResult =
  | { cancelled: true }
  | { cancelled: false; record: BackupRecord; renamed: boolean }

export interface SelectResult {
  cancelled: boolean
  token: string | null
  encrypted: boolean
  needsPassword: boolean
}

export interface BackupBridge {
  getStatus(): Promise<DataResult<BackupStatus>>
  setConfig(patch: Partial<BackupConfig>): Promise<DataResult<BackupStatus>>
  /** Opens a native save dialog in main. Optional password turns on encryption. */
  create(input: { password?: string }): Promise<DataResult<CreateResult>>
  /** Runs an automatic-style backup to the configured destination now. */
  createAutoNow(): Promise<DataResult<CreateResult>>
  chooseDestination(): Promise<DataResult<BackupStatus | null>>
  resetDestination(): Promise<DataResult<BackupStatus>>
  /** Picks a candidate through a native open dialog (no source) or from the tracked list (source = record id). */
  select(input: { recordId?: string }): Promise<DataResult<SelectResult>>
  /** Fully validates a candidate without touching live data. Also used for “Verify”. */
  inspect(input: { token: string; password?: string }): Promise<DataResult<Inspection>>
  /** Re-verifies a tracked backup and updates its status. */
  verifyRecord(input: { recordId: string; password?: string }): Promise<DataResult<BackupRecord>>
  /** Starts the staged restore. The app restarts to activate it. */
  restore(input: { token: string }): Promise<DataResult<{ restarting: boolean }>>
  forget(recordId: string): Promise<DataResult<BackupStatus>>
  dismissLastRestore(): Promise<DataResult<BackupStatus>>
  onEvent(listener: (e: BackupProgress) => void): () => void
}
