import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme } from 'electron'
import { join } from 'node:path'
import { IpcChannel, type AppInfo } from '@shared/ipc'
import { completeRestore, recoverPendingRestore, rollbackActivated } from './backup/restore'
import { registerBackupIpc } from './ipc/backup-handlers'
import { getAi, getBackups, getDocuments, getSemantic, getService, initDatabase, notifyContentChanged, shutdownDatabase, shutdownSemantic } from './database'
import { registerDocumentIpc } from './ipc/document-handlers'
import { registerAiIpc } from './ipc/ai-handlers'
import { registerDataIpc } from './ipc/data-handlers'
import { registerSemanticIpc } from './ipc/semantic-handlers'
import { registerSchemePrivileges, serveRendererFrom } from './protocol'
import { APP_ORIGIN, hardenSession, isTrustedSender } from './security'

// Charcoal canvas colour, so no white flash appears before the UI paints.
const CANVAS = '#121214'

app.enableSandbox()
registerSchemePrivileges()

// Tests and development can point at a throwaway profile; packaged builds always use the real one.
const userDataOverride = process.env['MINDSPACE_USER_DATA_DIR']
if (!app.isPackaged && userDataOverride) app.setPath('userData', userDataOverride)

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'MINDSPACE',
    backgroundColor: CANVAS,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => win.show())

  if (!app.isPackaged) {
    // Developer tools stay reachable during development only.
    win.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools()
    })
  }

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadURL(`${APP_ORIGIN}/index.html`)
  }
  return win
}

function registerIpc(): void {
  ipcMain.handle(IpcChannel.getAppInfo, (event): AppInfo => {
    if (!isTrustedSender(event.sender, event.senderFrame?.url)) {
      throw new Error('Untrusted sender')
    }
    return {
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      isPackaged: app.isPackaged
    }
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  void app.whenReady().then(() => {
    nativeTheme.themeSource = 'dark'
    Menu.setApplicationMenu(null)
    hardenSession()
    serveRendererFrom(join(__dirname, '../renderer'))
    registerIpc()
    registerDataIpc(getService, notifyContentChanged)
    registerDocumentIpc(getDocuments)
    registerSemanticIpc(getSemantic)
    registerAiIpc(getAi)
    registerBackupIpc(getBackups)
    // A staged restore is applied (or an interrupted one undone) before any database connection exists.
    const startup = recoverPendingRestore(app.getPath('userData'))
    let db = initDatabase()
    if (startup.action === 'activated') {
      if (db.ok) {
        completeRestore(app.getPath('userData'))
      } else {
        // The restored data would not open: put the previous data back and start with it.
        shutdownDatabase()
        if (rollbackActivated(app.getPath('userData'))) db = initDatabase()
      }
    }
    if (!db.ok) {
      // The window still opens and shows its error state; the file is left untouched.
      dialog.showErrorBox(
        'MINDSPACE could not open its database',
        `${db.error}\n\nFile: ${db.path}\n\nNothing was deleted or reset. Keep a copy of this file before trying anything else.`
      )
    }
    createMainWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  // Stop indexing and release the model first; an unfinished source is simply not committed.
  let quitting = false
  app.on('will-quit', (event) => {
    if (quitting) return
    quitting = true
    event.preventDefault()
    void Promise.race([shutdownSemantic(), new Promise((r) => setTimeout(r, 3000))])
      .catch((err) => console.error('[semantic] shutdown failed', err))
      .finally(() => {
        shutdownDatabase()
        // app.quit() is not re-entrant from a prevented will-quit; exit directly (all cleanup is done).
        app.exit(0)
      })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
