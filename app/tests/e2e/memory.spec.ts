import { _electron as electron, expect, test, type Page } from '@playwright/test'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Phase 3 in the real app: a decision with its project, a linked note and a
 * tag is created through the UI, the app is closed and started again on the
 * same temporary profile, and everything must still be connected.
 */
const userData = mkdtempSync(join(tmpdir(), 'mindspace-memory-'))
test.afterAll(() => rmSync(userData, { recursive: true, force: true }))

const launch = () =>
  electron.launch({ args: [resolve(__dirname, '../..')], env: { ...process.env, MINDSPACE_USER_DATA_DIR: userData } })

const english = async (win: Page) => {
  await win.evaluate(() => (location.hash = '#/settings'))
  await win.getByRole('radio', { name: 'English' }).first().click()
}

test('project memory, decisions and links survive an app restart', async () => {
  const stamp = Date.now()
  let app = await launch()
  let win = await app.firstWindow()
  await win.waitForSelector('h1')
  await english(win)

  // a project, a note inside it and a decision
  await win.evaluate(() => (location.hash = '#/projects'))
  await win.getByRole('button', { name: 'New project' }).first().click()
  await win.getByLabel('Name').fill(`Memory project ${stamp}`)
  await win.getByRole('button', { name: 'Create' }).click()
  await expect(win.getByRole('heading', { level: 1, name: `Memory project ${stamp}` })).toBeVisible()

  await win.getByRole('button', { name: 'New note' }).click()
  const capture = win.getByRole('dialog')
  await capture.getByLabel('Title').fill(`Why note ${stamp}`)
  await capture.getByRole('button', { name: 'Save capture' }).click()
  await expect(capture).toBeHidden()

  await win.getByRole('button', { name: 'New decision' }).first().click()
  const editor = win.getByRole('dialog', { name: 'New decision' })
  await editor.getByLabel('Title').fill(`Decision ${stamp}`)
  await editor.getByLabel('Decision', { exact: true }).fill('Ship it local-first.')
  await editor.getByRole('button', { name: 'Create' }).click()
  const drawer = win.getByRole('dialog', { name: `Decision ${stamp}` })
  await expect(drawer).toBeVisible()

  await drawer.getByRole('button', { name: 'Link note' }).click()
  const picker = win.getByRole('dialog', { name: 'Link a note' })
  await picker.getByRole('listitem').filter({ hasText: `Why note ${stamp}` }).getByRole('button', { name: 'Link' }).click()
  await expect(drawer.getByRole('link', { name: `Why note ${stamp}` })).toBeVisible()

  await drawer.getByRole('button', { name: 'Change status' }).click()
  await win.getByRole('menuitem', { name: 'Accept' }).click()
  await expect(drawer.getByText('Agreed and in effect.')).toBeVisible()
  await app.close()

  // the database holds exactly what the UI showed
  const raw = new Database(join(userData, 'mindspace.sqlite3'), { readonly: true })
  const row = raw.prepare('SELECT id, status, project_id FROM decisions WHERE title = ?').get(`Decision ${stamp}`) as {
    id: string
    status: string
    project_id: string
  }
  expect(row.status).toBe('accepted')
  expect(raw.prepare('SELECT COUNT(*) AS n FROM decision_items WHERE decision_id = ?').get(row.id)).toEqual({ n: 1 })
  expect(raw.prepare("SELECT COUNT(*) AS n FROM activity_events WHERE project_id = ? AND kind LIKE 'decision_%'").get(row.project_id)).toEqual({ n: 3 })
  raw.close()

  // restart: relationships, status and timeline are all still there
  app = await launch()
  win = await app.firstWindow()
  await win.waitForSelector('h1')
  await win.evaluate((id) => (location.hash = `#/projects/${id}?tab=decisions`), row.project_id)
  await expect(win.getByRole('button', { name: `Decision ${stamp}`, exact: true })).toBeVisible()
  await expect(win.getByText('Accepted').first()).toBeVisible()
  await win.getByRole('button', { name: `Decision ${stamp}`, exact: true }).click()
  const again = win.getByRole('dialog', { name: `Decision ${stamp}` })
  await expect(again.getByRole('link', { name: `Why note ${stamp}` })).toBeVisible()
  await again.getByRole('button', { name: 'Close' }).last().click()
  await win.getByRole('tab', { name: /Activity/ }).click()
  await expect(win.getByText('Decision accepted')).toBeVisible()
  await expect(win.getByText('Decision recorded')).toBeVisible()
  await app.close()
})
