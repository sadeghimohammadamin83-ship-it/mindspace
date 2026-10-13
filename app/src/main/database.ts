/**
 * Owns the single database connection of the running app. The file lives in
 * Electron's per-user data folder, never in the repo or install directory.
 * On failure the app shows the reason and does NOT recreate, reset or delete
 * the file.
 */
import { app, BrowserWindow, dialog } from 'electron'
import { BACKUP_EXTENSION, type BackupProgress } from '@shared/backup'
import { IpcChannel } from '@shared/ipc'
import { BackupError } from './backup/errors'
import { createBackupService, type BackupService } from './backup/service'
import { setMaintenance } from './maintenance'
import { MIGRATIONS } from './db/migrations'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Database } from 'better-sqlite3'
import { closeDatabase, DATABASE_FILE_NAME, openDatabase } from './db/connection'
import { seedSampleDataIfNew } from './db/seed'
import { extractPdfInWorker } from './documents/pdf-runner'
import { createAiServices, type AiServices } from './ai/ai-services'
import { createDocumentService, SUPPORTED_EXTENSIONS, type DocumentService } from './services/document-service'
import { createWorkspaceService, DataError, type WorkspaceService } from './services/workspace-service'
import { E5_MODEL } from './semantic/model-manifest'
import { createModelStore } from './semantic/model-store'
import { createSemanticService, type SemanticService } from './semantic/semantic-service'
import { WorkerEmbeddingProvider } from './semantic/worker-provider'

let db: Database | null = null
let service: WorkspaceService | null = null
let documents: DocumentService | null = null
let semantic: SemanticService | null = null
let ai: Promise<AiServices> | null = null
let failure: string | null = null
let backups: BackupService | null = null

function dialogParent() {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
}
const showOpen = (o: Electron.OpenDialogOptions) => {
  const w = dialogParent()
  return w ? dialog.showOpenDialog(w, o) : dialog.showOpenDialog(o)
}

/**
 * The backup service does not need an open database for restore, so it exists
 * even when the database failed to open (that is exactly when a restore helps).
 */
function startBackups(): BackupService {
  const service = createBackupService({
    getDb: () => {
      if (!db) throw new BackupError('unavailable', 'The database is not open.')
      return db
    },
    userData: app.getPath('userData'),
    documentsDir: documentsDir(),
    appVersion: app.getVersion(),
    latestSchema: Math.max(...MIGRATIONS.map((m) => m.version)),
    dialogs: {
      async saveBackup(defaultName) {
        const o: Electron.SaveDialogOptions = {
          title: 'Save MINDSPACE backup',
          defaultPath: join(app.getPath('documents'), defaultName),
          filters: [{ name: 'MINDSPACE backup', extensions: [BACKUP_EXTENSION] }],
          properties: ['createDirectory', 'showOverwriteConfirmation']
        }
        const w = dialogParent()
        const r = w ? await dialog.showSaveDialog(w, o) : await dialog.showSaveDialog(o)
        return r.canceled || !r.filePath ? null : r.filePath
      },
      async openBackup() {
        const r = await showOpen({ title: 'Choose a MINDSPACE backup', properties: ['openFile', 'dontAddToRecent'], filters: [{ name: 'MINDSPACE backup', extensions: [BACKUP_EXTENSION] }] })
        return r.canceled ? null : (r.filePaths[0] ?? null)
      },
      async chooseFolder() {
        const r = await showOpen({ title: 'Choose a folder for automatic backups', properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'] })
        return r.canceled ? null : (r.filePaths[0] ?? null)
      }
    },
    setMaintenance,
    requestRestart: () => {
      // The restore is applied by the next start, before the database opens.
      setTimeout(() => {
        app.relaunch()
        app.quit()
      }, 300)
    },
    emit: (p: BackupProgress) => {
      for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(IpcChannel.backupEvent, p)
    }
  })
  void service.cleanupLeftovers()
  return service
}

export function getBackups(): BackupService {
  if (!backups) throw new BackupError('unavailable', 'Backups are not available yet.')
  return backups
}

export const databasePath = () => join(app.getPath('userData'), DATABASE_FILE_NAME)
/** Managed copies of imported documents. */
export const documentsDir = () => join(app.getPath('userData'), 'documents')
/**
 * Local embedding model files. Development and tests can point at a
 * pre-provisioned copy; packaged builds always use the per-user folder.
 */
export const modelDir = () => {
  const override = process.env['MINDSPACE_MODEL_DIR']
  if (!app.isPackaged && override) return override
  return join(app.getPath('userData'), 'models', E5_MODEL.repo.replace('/', '__'), E5_MODEL.revision)
}

async function selectFiles(): Promise<string[] | null> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const options: Electron.OpenDialogOptions = {
    title: 'Import documents',
    properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
    filters: [{ name: 'Documents (PDF, TXT, Markdown)', extensions: SUPPORTED_EXTENSIONS }]
  }
  const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  return r.canceled ? null : r.filePaths
}

export function initDatabase(): { ok: true; path: string } | { ok: false; path: string; error: string } {
  const path = databasePath()
  backups ??= startBackups()
  try {
    db = openDatabase(path)
    seedSampleDataIfNew(db)
    service = createWorkspaceService(db)
    mkdirSync(documentsDir(), { recursive: true })
    semantic = createSemanticService({
      db,
      store: createModelStore(modelDir()),
      createProvider: (dir) => new WorkerEmbeddingProvider({ dir })
    })
    const sem = semantic
    documents = createDocumentService({ db, dir: documentsDir(), selectFiles, extractPdf: extractPdfInWorker, onChange: () => sem.notifyChanged() })
    // Document recovery first (it may rebuild FTS), then load an installed model and catch up on embeddings.
    void documents
      .recover()
      .then(
        (r) => console.info('[documents] start-up recovery', r),
        (err) => console.error('[documents] recovery failed', err)
      )
      .then(() => sem.start())
      .catch((err) => console.error('[semantic] start-up failed', err))
    backups.startScheduler()
    ai = createAiServices({ db, userDataDir: app.getPath('userData'), retrieve: (q) => sem.retrieve(q) })
    ai.catch((err) => console.error('[ai] start-up failed', err instanceof Error ? err.name : 'error'))
    return { ok: true, path }
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err)
    console.error('[db] initialisation failed', err)
    return { ok: false, path, error: failure }
  }
}

export function getService(): WorkspaceService {
  if (!service) throw new DataError('unavailable', failure ?? 'Database is not open')
  return service
}

export function getDocuments(): DocumentService {
  if (!documents) throw new DataError('unavailable', failure ?? 'Database is not open')
  return documents
}

export function getAi(): Promise<AiServices> {
  if (!ai) return Promise.reject(new DataError('unavailable', failure ?? 'Database is not open'))
  return ai
}

export function getSemantic(): SemanticService {
  if (!semantic) throw new DataError('unavailable', failure ?? 'Database is not open')
  return semantic
}

/** After any content write: re-embed what changed (debounced, in the background). */
export function notifyContentChanged(): void {
  semantic?.notifyChanged()
}

/** Stops indexing between batches and releases the model before the database closes. */
export async function shutdownSemantic(): Promise<void> {
  // Abort running generations first so their partial text is saved before the database closes.
  await ai?.then((a) => a.answers.cancelAll()).catch(() => undefined)
  const s = semantic
  semantic = null
  await s?.close()
}

export function shutdownDatabase(): void {
  backups?.stopScheduler()
  if (!db) return
  try {
    closeDatabase(db)
  } catch (err) {
    console.error('[db] close failed', err)
  }
  db = null
  service = null
  documents = null
  semantic = null
  ai = null
}
