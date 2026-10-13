import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * The real thing: build a backup through the UI, change the workspace, restore
 * through the UI, let the app actually quit, start it again and check that the
 * restore was applied at start-up and the earlier state is back. Native file
 * dialogs cannot be driven, so the main-process dialog functions are stubbed
 * with fixed paths; everything else is the production code path. Only
 * `app.relaunch` is stubbed (a relaunched process would escape the test).
 */
const root = mkdtempSync(join(tmpdir(), 'mindspace-backup-e2e-'))
const userData = join(root, 'profile')
const outDir = join(root, 'out')
test.afterAll(() => rmSync(root, { recursive: true, force: true }))

const launch = () => electron.launch({ args: [resolve(__dirname, '../..')], env: { ...process.env, MINDSPACE_USER_DATA_DIR: userData } })

async function stubDialogs(app: ElectronApplication, file: string) {
  await app.evaluate(({ dialog, app: a }, f) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: f })) as never
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [f] })) as never
    a.relaunch = (() => undefined) as never
  }, file)
}

async function addNote(win: Page, title: string) {
  await win.getByRole('button', { name: 'Capture', exact: true }).click()
  const dlg = win.getByRole('dialog')
  await dlg.getByLabel('Title').fill(title)
  await dlg.getByRole('button', { name: 'Save capture' }).click()
  await expect(dlg).toBeHidden()
}

test('create → change → restore → restart brings the backed-up state back', async () => {
  mkdirSync(outDir, { recursive: true })
  const backupFile = join(outDir, 'e2e.msbak')
  const stamp = Date.now()
  let app = await launch()
  let win = await app.firstWindow()
  await win.waitForSelector('h1')
  await win.evaluate(() => (location.hash = '#/settings'))
  await win.getByRole('radio', { name: 'English' }).first().click()
  await win.getByRole('link', { name: 'Dashboard' }).click()
  await addNote(win, `Before backup ${stamp}`)

  await stubDialogs(app, backupFile)
  await win.getByRole('link', { name: 'Settings' }).click()
  await win.getByRole('button', { name: 'Create backup…' }).click()
  await win.getByRole('dialog').getByRole('button', { name: /Choose location and create/ }).click()
  await expect(win.getByText(/Backup saved and verified: e2e\.msbak/)).toBeVisible({ timeout: 20_000 })
  expect(existsSync(backupFile)).toBe(true)
  expect(readFileSync(backupFile).subarray(0, 8).toString()).toBe('MSBACKUP')

  await win.getByRole('link', { name: 'Dashboard' }).click()
  await addNote(win, `After backup ${stamp}`)

  await win.getByRole('link', { name: 'Settings' }).click()
  await win.getByRole('button', { name: 'Restore from backup…' }).click()
  const dlg = win.getByRole('dialog')
  await expect(dlg.getByText('This replaces your current data')).toBeVisible({ timeout: 20_000 })
  const exited = new Promise<void>((r) => app.process().once('exit', () => r()))
  await dlg.getByRole('button', { name: 'Replace my data and restart' }).click()
  await exited // the app really quits; the restore is applied by the next start

  // Staged, not yet applied, and a verified safety backup exists.
  expect(JSON.parse(readFileSync(join(userData, 'restore-journal.json'), 'utf8')).state).toBe('staged')
  expect(readdirSync(join(userData, 'backups', 'safety')).filter((n) => n.endsWith('.msbak'))).toHaveLength(1)

  app = await launch()
  win = await app.firstWindow()
  await win.waitForSelector('h1')
  await win.getByRole('link', { name: 'Knowledge Library' }).click()
  await expect(win.locator('main').getByRole('button', { name: `Before backup ${stamp}`, exact: true })).toBeVisible()
  await expect(win.locator('main').getByRole('button', { name: `After backup ${stamp}`, exact: true })).toHaveCount(0)
  await win.getByRole('link', { name: 'Settings' }).click()
  await expect(win.getByText('The last restore completed.')).toBeVisible()
  await expect(win.getByText('Safety (before a restore)')).toBeVisible()
  expect(JSON.parse(readFileSync(join(userData, 'restore-journal.json'), 'utf8')).state).toBe('completed')
  expect(readdirSync(join(userData, 'restore-previous'))).toEqual([])
  await app.close()
})

test('a damaged backup is rejected in the UI and nothing is changed', async () => {
  const bad = join(outDir, 'damaged.msbak')
  const buf = readFileSync(join(outDir, 'e2e.msbak'))
  buf[Math.floor(buf.length / 2)] = ~buf[Math.floor(buf.length / 2)]! & 0xff
  require('node:fs').writeFileSync(bad, buf)
  const app = await launch()
  const win = await app.firstWindow()
  await win.waitForSelector('h1')
  await stubDialogs(app, bad)
  await win.evaluate(() => (location.hash = '#/settings'))
  await win.getByRole('button', { name: 'Restore from backup…' }).click()
  const dlg = win.getByRole('dialog')
  await expect(dlg.getByRole('alert')).toBeVisible({ timeout: 20_000 })
  await expect(dlg.getByRole('button', { name: 'Replace my data and restart' })).toHaveCount(0)
  await app.close()
})
