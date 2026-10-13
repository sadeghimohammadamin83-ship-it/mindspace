import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BackupBridge } from '@shared/backup'
import { IpcChannel } from '@shared/ipc'
import { App } from '@/app/App'
import { closeDatabase, openDatabase } from '../../src/main/db/connection'
import { seedSampleDataIfNew } from '../../src/main/db/seed'
import { MIGRATIONS } from '../../src/main/db/migrations'
import { createBackupService } from '../../src/main/backup/service'
import { backupHandlers, backupResult } from '../../src/main/ipc/backup-handlers'
import { createWorkspaceService } from '../../src/main/services/workspace-service'
import { bridgeFor, tempDir } from './helpers/db'

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.scrollTo ??= () => {}
})
afterEach(() => {
  cleanup()
  location.hash = ''
})

function setup() {
  const tmp = tempDir()
  const userData = join(tmp.dir, 'ud')
  mkdirSync(join(userData, 'documents'), { recursive: true })
  const db = openDatabase(join(userData, 'mindspace.sqlite3'))
  seedSampleDataIfNew(db)
  const ws = createWorkspaceService(db)
  const dlg = { save: join(tmp.dir, 'out', 'ui.msbak') as string | null, open: null as string | null }
  let restarts = 0
  const svc = createBackupService({
    getDb: () => db,
    userData,
    documentsDir: join(userData, 'documents'),
    appVersion: '1.2.3',
    latestSchema: Math.max(...MIGRATIONS.map((m) => m.version)),
    dialogs: { saveBackup: async () => dlg.save, openBackup: async () => dlg.open, chooseFolder: async () => null },
    requestRestart: () => void restarts++,
    setMaintenance: () => undefined
  })
  const handlers = backupHandlers(() => svc)
  const call = async (channel: string, ...args: unknown[]) => structuredClone(await backupResult(() => handlers[channel]!(...structuredClone(args))))
  const C = IpcChannel
  const api: BackupBridge = {
    getStatus: () => call(C.backupStatus),
    setConfig: (p) => call(C.backupConfig, p),
    create: (i) => call(C.backupCreate, i),
    createAutoNow: () => call(C.backupCreateAuto),
    chooseDestination: () => call(C.backupChooseDestination),
    resetDestination: () => call(C.backupResetDestination),
    select: (i) => call(C.backupSelect, i),
    inspect: (i) => call(C.backupInspect, i),
    verifyRecord: (i) => call(C.backupVerifyRecord, i),
    restore: (i) => call(C.backupRestore, i),
    forget: (id) => call(C.backupForget, id),
    dismissLastRestore: () => call(C.backupDismissRestore),
    onEvent: () => () => undefined
  } as BackupBridge
  const done = () => {
    cleanup()
    closeDatabase(db)
    tmp.cleanup()
  }
  return { tmp, svc, api, dlg, done, restarts: () => restarts, data: bridgeFor(() => ws) }
}

const renderSettings = (s: ReturnType<typeof setup>, lang: 'en' | 'fa' = 'en') => {
  location.hash = '#/settings'
  return render(<App api={s.data} backupApi={s.api} preferences={{ lang, reduceMotion: true }} />)
}

describe('Backup & recovery panel', () => {
  it('creates an unencrypted backup and lists it as verified only after the backend confirms', async () => {
    const s = setup()
    try {
      const user = userEvent.setup()
      renderSettings(s)
      expect((await screen.findByTestId('backup-last')).textContent).toContain('No backup yet')
      await user.click(await screen.findByRole('button', { name: 'Create backup…' }))
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByText(/not encrypted/i)).toBeTruthy()
      await user.click(within(dialog).getByRole('button', { name: /Choose location and create/ }))
      expect(await screen.findByText(/Backup saved and verified: ui\.msbak/)).toBeTruthy()
      const rec = await screen.findByTestId('backup-record')
      expect(rec.textContent).toContain('ui.msbak')
      expect(rec.textContent).toContain('Verified')
      expect(rec.textContent).toContain('Not encrypted')
      expect(screen.getByTestId('backup-last').textContent).not.toContain('No backup yet')
    } finally {
      s.done()
    }
  })

  it('requires a long enough matching password before an encrypted backup can be made', async () => {
    const s = setup()
    try {
      const user = userEvent.setup()
      renderSettings(s)
      await user.click(await screen.findByRole('button', { name: 'Create backup…' }))
      const dialog = await screen.findByRole('dialog')
      await user.click(within(dialog).getByRole('switch'))
      const go = within(dialog).getByRole('button', { name: /Choose location and create/ })
      expect((go as HTMLButtonElement).disabled).toBe(true)
      const [pw, pw2] = within(dialog).getAllByLabelText(/password/i, { selector: 'input' })
      await user.type(pw!, 'short')
      expect(await within(dialog).findByText(/at least 8 characters/)).toBeTruthy()
      await user.clear(pw!)
      await user.type(pw!, 'long enough password')
      await user.type(pw2!, 'different password!')
      expect(await within(dialog).findByText('The passwords do not match.')).toBeTruthy()
      expect((go as HTMLButtonElement).disabled).toBe(true)
      expect(within(dialog).getByText(/cannot be opened/)).toBeTruthy()
      await user.clear(pw2!)
      await user.type(pw2!, 'long enough password')
      expect((go as HTMLButtonElement).disabled).toBe(false)
      await user.click(go)
      const rec = await screen.findByTestId('backup-record')
      expect(rec.textContent).toContain('Password protected')
      expect(readFileSync(s.dlg.save!).includes(Buffer.from('SQLite format 3'))).toBe(false)
    } finally {
      s.done()
    }
  })

  it('shows a clear warning and only restarts after explicit confirmation', async () => {
    const s = setup()
    try {
      const user = userEvent.setup()
      await s.svc.create({}) // dialog.save is set
      renderSettings(s)
      const rec = await screen.findByTestId('backup-record')
      await user.click(within(rec).getByRole('button', { name: 'Restore from backup' }))
      const dialog = await screen.findByRole('dialog')
      expect(await within(dialog).findByText('This replaces your current data')).toBeTruthy()
      expect(within(dialog).getByText(/Nothing is merged/)).toBeTruthy()
      expect(within(dialog).getByText('Structure, sizes and checksums match.')).toBeTruthy()
      expect(within(dialog).getByText(/Not included/)).toBeTruthy()
      expect(s.restarts()).toBe(0)
      await user.click(within(dialog).getByRole('button', { name: 'Replace my data and restart' }))
      await waitFor(() => expect(s.restarts()).toBe(1))
      expect(await within(dialog).findAllByText(/restarting/i)).not.toHaveLength(0)
    } finally {
      s.done()
    }
  })

  it('shows the real failure for a damaged file and offers no restore', async () => {
    const s = setup()
    try {
      const user = userEvent.setup()
      mkdirSync(join(s.tmp.dir, 'in'))
      s.dlg.open = join(s.tmp.dir, 'in', 'bad.msbak')
      writeFileSync(s.dlg.open, 'this is not a backup')
      renderSettings(s)
      await user.click(await screen.findByRole('button', { name: 'Restore from backup…' }))
      const dialog = await screen.findByRole('dialog')
      expect((await within(dialog).findByRole('alert')).textContent).toMatch(/not a MINDSPACE backup/)
      expect(within(dialog).queryByRole('button', { name: /Replace my data/ })).toBeNull()
      expect(within(dialog).queryByText('Structure, sizes and checksums match.')).toBeNull()
    } finally {
      s.done()
    }
  })

  it('turns automatic backups on and states that they only run while the app is open', async () => {
    const s = setup()
    try {
      const user = userEvent.setup()
      renderSettings(s)
      const sw = await screen.findByRole('switch', { name: 'Back up automatically' })
      expect(screen.getByText(/Runs only while MINDSPACE is open/)).toBeTruthy()
      await user.click(sw)
      await waitFor(() => expect(s.svc.getStatus().config.autoEnabled).toBe(true))
      expect(await screen.findByText(/due now/)).toBeTruthy()
    } finally {
      s.done()
    }
  })

  it('renders in Persian', async () => {
    const s = setup()
    try {
      renderSettings(s, 'fa')
      expect(await screen.findByRole('button', { name: 'ساخت پشتیبان…' })).toBeTruthy()
      expect(screen.getByText(/فقط وقتی MINDSPACE باز است اجرا می‌شود/)).toBeTruthy()
    } finally {
      s.done()
    }
  })
})
