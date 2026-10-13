import { _electron as electron, expect, test, type Page } from '@playwright/test'
import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Real application restarts: launch the built app, write data through the UI,
 * quit Electron, launch it again on the same (temporary) profile and check
 * that the data and a preference survived.
 */
const userData = mkdtempSync(join(tmpdir(), 'mindspace-restart-'))
test.afterAll(() => rmSync(userData, { recursive: true, force: true }))

const launch = () =>
  electron.launch({ args: [resolve(__dirname, '../..')], env: { ...process.env, MINDSPACE_USER_DATA_DIR: userData } })

const nav = (w: Page) => w.getByRole('complementary', { name: 'Main navigation' })

test('notes, tasks, projects and settings survive an app restart', async () => {
  const stamp = Date.now()
  let app = await launch()
  let win = await app.firstWindow()
  await win.waitForSelector('h1')
  expect(existsSync(join(userData, 'mindspace.sqlite3'))).toBe(true)

  // English, so selectors are stable; the choice itself must persist.
  await win.evaluate(() => (location.hash = '#/settings'))
  await win.getByRole('radio', { name: 'English' }).first().click()

  await win.getByRole('link', { name: 'Dashboard' }).click()
  await win.getByRole('button', { name: 'Capture', exact: true }).click()
  const dlg = win.getByRole('dialog')
  await dlg.getByLabel('Title').fill(`Restart note ${stamp}`)
  await dlg.getByRole('button', { name: 'Save capture' }).click()
  await expect(dlg).toBeHidden()

  await nav(win).getByRole('link', { name: 'Projects' }).click()
  await win.getByRole('button', { name: 'New project' }).first().click()
  await win.getByLabel('Name').fill(`Restart project ${stamp}`)
  await win.getByRole('button', { name: 'Create' }).click()
  await expect(win.getByRole('heading', { level: 1, name: `Restart project ${stamp}` })).toBeVisible()

  await nav(win).getByRole('link', { name: 'Tasks' }).click()
  await win.getByRole('button', { name: 'New task' }).click()
  await win.getByLabel('Title').fill(`Restart task ${stamp}`)
  await win.getByRole('button', { name: 'Create' }).click()
  await win.getByRole('checkbox', { name: `Mark “Restart task ${stamp}” as done` }).click()
  await expect(win.getByRole('checkbox', { name: `Reopen “Restart task ${stamp}”` })).toBeVisible()
  await app.close()

  app = await launch()
  win = await app.firstWindow()
  await win.waitForSelector('h1')
  await expect(win.getByRole('link', { name: 'Dashboard' })).toBeVisible() // still English
  await nav(win).getByRole('link', { name: 'Knowledge Library' }).click()
  await expect(win.locator('main').getByRole('button', { name: `Restart note ${stamp}`, exact: true })).toBeVisible()
  await nav(win).getByRole('link', { name: 'Projects' }).click()
  await expect(win.locator('main').getByText(`Restart project ${stamp}`)).toBeVisible()
  await nav(win).getByRole('link', { name: 'Tasks' }).click()
  await win.getByRole('radio', { name: 'Done', exact: true }).click()
  await expect(win.getByRole('checkbox', { name: `Reopen “Restart task ${stamp}”` })).toBeVisible()
  // Sample data was inserted once, not again on the second launch.
  await app.close()
  const db = new Database(join(userData, 'mindspace.sqlite3'), { readonly: true })
  const counts = db
    .prepare("SELECT (SELECT COUNT(*) FROM projects WHERE id = 'proj-mindspace') AS sample, (SELECT COUNT(*) FROM schema_migrations) AS migrations")
    .get()
  db.close()
  expect(counts).toEqual({ sample: 1, migrations: 5 })
})
