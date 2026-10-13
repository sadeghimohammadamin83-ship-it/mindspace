import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

let app: ElectronApplication
let win: Page
const errors: string[] = []
// A throwaway profile, so tests never touch the real database.
const userData = mkdtempSync(join(tmpdir(), 'mindspace-e2e-'))

test.beforeAll(async () => {
  app = await electron.launch({ args: [resolve(__dirname, '../..')], env: { ...process.env, MINDSPACE_USER_DATA_DIR: userData } })
  win = await app.firstWindow()
  win.on('pageerror', (e) => errors.push(e.message))
  win.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await win.waitForSelector('h1')
  await win.evaluate(() => (location.hash = '#/settings'))
  await win.getByRole('radio', { name: 'English' }).first().click()
  await win.getByRole('link', { name: 'Dashboard' }).click()
})
test.afterAll(async () => {
  expect(errors).toEqual([])
  await app.close()
  rmSync(userData, { recursive: true, force: true })
})

test('security: isolation on, no Node in renderer, strict CSP', async () => {
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0]!.webContents as unknown as {
      getLastWebPreferences(): { contextIsolation: boolean; nodeIntegration: boolean; sandbox: boolean }
    }
    const wp = wc.getLastWebPreferences()
    return { ci: wp.contextIsolation, ni: wp.nodeIntegration, sb: wp.sandbox }
  })
  expect(prefs).toEqual({ ci: true, ni: false, sb: true })
  const g = await win.evaluate(() => ({ r: typeof require, p: typeof process, api: Object.keys((window as unknown as { mindspace?: object }).mindspace ?? {}) }))
  expect(g).toEqual({ r: 'undefined', p: 'undefined', api: ['getAppInfo', 'data', 'documents', 'retrieval', 'ai', 'backup'] })
  // The data API is a fixed set of named operations; bad payloads are rejected in main.
  const probe = await win.evaluate(async () => {
    const data = (window as unknown as { mindspace: { data: Record<string, (...a: unknown[]) => Promise<unknown>> } }).mindspace.data
    return {
      methods: Object.keys(data).sort(),
      backupMethods: Object.keys((window as unknown as { mindspace: { backup: object } }).mindspace.backup).sort(),
      backupBadPath: await (window as unknown as { mindspace: { backup: { select(i: unknown): Promise<unknown> } } }).mindspace.backup.select({ file: 'C:\\Windows\\win.ini' }),
      bad: await data['createTask']!({ title: '', status: 'nope', sql: 'DROP TABLE tasks' }),
      info: await (window as unknown as { mindspace: { getAppInfo(): Promise<{ electron: string }> } }).mindspace.getAppInfo().then((i) => typeof i.electron)
    }
  })
  expect(probe.methods).toEqual([
    'createDecision', 'createItem', 'createProject', 'createTag', 'createTask', 'deleteDecision', 'deleteItem', 'deleteProject', 'deleteTag', 'deleteTask',
    'getPreferences', 'linkDecision', 'listProjectActivity', 'listTasks', 'loadWorkspace', 'renameTag', 'searchItems', 'setDecisionStatus', 'setPreferences',
    'setTaskStatus', 'unlinkDecision', 'updateDecision', 'updateItem', 'updateProject', 'updateTask'
  ])
  expect(probe.backupMethods).toEqual(['chooseDestination', 'create', 'createAutoNow', 'dismissLastRestore', 'forget', 'getStatus', 'inspect', 'onEvent', 'resetDestination', 'restore', 'select', 'setConfig', 'verifyRecord'])
  expect(probe.backupBadPath).toMatchObject({ ok: false, error: { code: 'validation' } })
  expect(probe.bad).toMatchObject({ ok: false, error: { code: 'validation' } })
  expect(probe.info).toBe('string')
  const csp = await win.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
  expect(csp).toContain("default-src 'none'")
  expect(win.url().startsWith('app://mindspace/')).toBe(true)
})

test('every sidebar item opens its screen and shows active state', async () => {
  const nav = win.getByRole('complementary', { name: 'Main navigation' })
  const pages: Array<[string, string]> = [
    ['Quick Capture', 'Quick Capture'], ['Knowledge Library', 'Knowledge Library'], ['Projects', 'Projects'],
    ['Tasks', 'Tasks'], ['Ask Your Memory', 'Ask Your Memory'], ['Daily Briefing', 'Daily Briefing'],
    ['Settings', 'Settings'], ['Dashboard', 'Dashboard']
  ]
  for (const [link, title] of pages) {
    await nav.getByRole('link', { name: link }).click()
    await expect(nav.getByRole('link', { name: link })).toHaveAttribute('aria-current', 'page')
    await expect(win.locator('main').getByRole('heading', { level: 1 }).first()).toContainText(title === 'Daily Briefing' || title === 'Dashboard' ? /\w/ : title)
  }
})

test('quick capture validates, saves, and appears in the library', async () => {
  await win.getByRole('button', { name: 'Capture', exact: true }).click()
  const dlg = win.getByRole('dialog')
  await dlg.getByRole('button', { name: 'Save capture' }).click()
  await expect(dlg.getByText('Give it a title')).toBeVisible()
  await dlg.getByLabel('Title').fill('E2E captured idea')
  await dlg.getByLabel('Content').fill('Body text for the e2e test')
  await dlg.getByLabel('Content').press('Control+Enter')
  await expect(win.getByText('Idea captured').or(win.getByText('Note captured'))).toBeVisible()
  await expect(dlg).toBeHidden()
  await win.getByRole('link', { name: 'Knowledge Library' }).click()
  await expect(win.locator('main').getByRole('heading', { level: 1 })).toHaveText('Knowledge Library')
  await expect(win.locator('main').getByRole('button', { name: 'E2E captured idea', exact: true })).toBeVisible()
})

test('library search, filters, empty state and detail drawer', async () => {
  await win.getByRole('link', { name: 'Knowledge Library' }).click()
  await win.getByRole('searchbox', { name: 'Search the library' }).fill('sqlite')
  await expect(win.getByText(/\d+ of \d+ items/)).toContainText('1 of')
  await win.getByRole('searchbox', { name: 'Search the library' }).fill('zzzznothing')
  await expect(win.getByText('No items match these filters')).toBeVisible()
  await win.getByRole('button', { name: 'Clear filters' }).first().click()
  await win.getByRole('radio', { name: /^Links/ }).click()
  await expect(win.locator('article')).toHaveCount(4)
  await win.locator('article button').first().click()
  await expect(win.getByRole('dialog')).toBeVisible()
  await win.keyboard.press('Escape')
  await expect(win.getByRole('dialog')).toBeHidden()
})

test('global search opens a record', async () => {
  const box = win.getByRole('combobox', { name: 'Global search' })
  await box.fill('invoices')
  await expect(win.getByRole('option').first()).toBeVisible()
  await box.press('Enter')
  await expect(win.getByRole('dialog')).toBeVisible()
  await win.keyboard.press('Escape')
  await expect(win.getByRole('dialog')).toBeHidden()
})

test('tasks: create, complete, filter', async () => {
  await win.getByRole('link', { name: 'Tasks' }).click()
  await win.getByRole('button', { name: 'New task' }).click()
  await win.getByRole('button', { name: 'Create' }).click()
  await expect(win.getByText('Give the task a title')).toBeVisible()
  await win.getByLabel('Title').fill('E2E new task')
  await win.getByRole('button', { name: 'Create' }).click()
  const check = win.getByRole('checkbox', { name: 'Mark “E2E new task” as done' })
  await expect(check).toBeVisible()
  await check.click()
  await expect(win.getByRole('checkbox', { name: 'Reopen “E2E new task”' })).toBeVisible()
  await win.getByRole('radio', { name: 'Done', exact: true }).click()
  await expect(win.locator('main').getByText('E2E new task')).toBeVisible()
  await win.getByRole('radio', { name: 'To do' }).click()
  await expect(win.locator('main').getByText('E2E new task')).toHaveCount(0)
})

test('projects: create flow and detail', async () => {
  await win.getByRole('link', { name: 'Projects' }).click()
  await win.getByRole('button', { name: 'New project' }).first().click()
  await win.getByLabel('Name').fill('E2E project')
  await win.getByRole('button', { name: 'Create' }).click()
  await expect(win.getByRole('heading', { level: 1, name: 'E2E project' })).toBeVisible()
})

test('ask: without a configured provider the page says so and nothing is sent anywhere', async () => {
  await win.getByRole('link', { name: 'Ask Your Memory' }).click()
  await expect(win.getByText('No AI provider is ready')).toBeVisible()
  await expect(win.getByLabel('Your question')).toBeDisabled()
  await win.getByRole('link', { name: 'Settings' }).first().click()
  const panel = win.getByRole('region', { name: 'AI provider' })
  await expect(panel.getByRole('radio', { name: /Ollama/ })).toBeVisible()
  // A cloud key cannot be saved without OS-level encryption, and never comes back to the page.
  const api = await win.evaluate(() => Object.keys((window as unknown as { mindspace: { ai: object } }).mindspace.ai).sort())
  expect(api).not.toContain('getKey')
  // The renderer cannot reach the network at all.
  const blocked = await win.evaluate(() => fetch('https://api.anthropic.com/v1/models').then(() => 'reached', () => 'blocked'))
  expect(blocked).toBe('blocked')
  // The refusal is the expected console output of the probe above, not an app error.
  for (let i = errors.length - 1; i >= 0; i--) if (errors[i]!.includes('api.anthropic.com')) errors.splice(i, 1)
})

test('narrow window collapses sidebar', async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1000, 700))
  await expect(win.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900))
})
