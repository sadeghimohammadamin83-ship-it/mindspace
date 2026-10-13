import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Phase 4 in the real built app: import via the main-process dialog flow
 * (only the OS dialog itself is stubbed, in main, to return fixture copies),
 * PDF extraction in the worker thread, FTS5 search from the top bar, the
 * reader at the right page, and a restart. Synthetic fixtures only.
 */
const FIX = resolve(__dirname, '../fixtures/documents')
const userData = mkdtempSync(join(tmpdir(), 'mindspace-docs-'))
const sources = mkdtempSync(join(tmpdir(), 'mindspace-src-'))
test.afterAll(() => {
  rmSync(userData, { recursive: true, force: true })
  rmSync(sources, { recursive: true, force: true })
})

const launch = () =>
  electron.launch({ args: [resolve(__dirname, '../..')], env: { ...process.env, MINDSPACE_USER_DATA_DIR: userData } })
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex')

async function stubDialog(app: ElectronApplication, paths: string[]) {
  await app.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: files })) as typeof dialog.showOpenDialog
  }, paths)
}

async function english(win: Page) {
  await win.evaluate(() => (location.hash = '#/settings'))
  await win.getByRole('radio', { name: 'English' }).first().click()
}

test('import, extract, search to the right page, and survive a restart', async () => {
  const names = ['sample-multipage.pdf', 'sample-persian-pdf.pdf', 'sample-scanned.pdf', 'sample-document.md']
  const paths = names.map((n) => {
    copyFileSync(join(FIX, n), join(sources, n))
    return join(sources, n)
  })
  const before = paths.map(sha)

  let app = await launch()
  let win = await app.firstWindow()
  await win.waitForSelector('h1')
  await english(win)
  const errors: string[] = []
  win.on('pageerror', (e) => errors.push(String(e)))

  await win.getByRole('link', { name: 'Documents' }).click()
  await expect(win.getByRole('heading', { level: 1, name: 'Documents' })).toBeVisible()
  await stubDialog(app, paths)
  await win.getByRole('button', { name: 'Import documents' }).first().click()
  await expect(win.getByText('4 imported')).toBeVisible()
  await expect(win.getByText('Searchable', { exact: true })).toHaveCount(3, { timeout: 30_000 })
  await expect(win.getByText('No searchable text')).toHaveCount(1)

  // Duplicate import is reported, not re-added.
  await stubDialog(app, [paths[0]!])
  await win.getByRole('button', { name: 'Import documents' }).first().click()
  await expect(win.getByRole('heading', { level: 1, name: 'sample-multipage' })).toBeVisible()
  await win.getByRole('link', { name: 'All documents' }).click()

  // Global search → PDF page 3
  const box = win.getByRole('combobox', { name: 'Global search' })
  await box.fill('zephyr quartz')
  await win.getByRole('option', { name: /sample-multipage.*Page 3/ }).click()
  await expect(win.getByText('Page 3 of 5')).toBeVisible()
  await expect(win.getByTestId('document-text')).toContainText('zephyr quartz ledger appears only on this page')

  // Persian query with Persian kaf finds the Arabic-kaf text on page 2.
  await box.fill('کتاب')
  await win.getByRole('option', { name: /sample-persian-pdf.*Page 2/ }).click()
  await expect(win.getByText('Page 2 of 2')).toBeVisible()

  const managed = readdirSync(join(userData, 'documents'))
  expect(managed).toHaveLength(4)
  await app.close()

  // Restart: records, pages and index persist; originals untouched.
  app = await launch()
  win = await app.firstWindow()
  await win.waitForSelector('h1')
  await win.evaluate(() => (location.hash = '#/documents'))
  await expect(win.getByText('Searchable', { exact: true })).toHaveCount(3)
  await win.getByRole('combobox', { name: 'Global search' }).fill('orchid meridian')
  await expect(win.getByRole('option', { name: /Page 2/ })).toBeVisible()
  await expect(win.getByRole('option', { name: /Page 3/ })).toBeVisible()

  // Remove one document from its reader.
  await win.getByRole('combobox', { name: 'Global search' }).fill('saffron roadmap')
  await win.getByRole('option', { name: /sample-document/ }).first().click()
  await win.getByRole('button', { name: 'Remove' }).click()
  await win.getByRole('dialog').getByRole('button', { name: 'Remove' }).click()
  await expect(win.getByRole('heading', { level: 1, name: 'Documents' })).toBeVisible()
  await win.getByRole('combobox', { name: 'Global search' }).fill('saffron roadmap')
  await expect(win.getByRole('option', { name: /sample-document/ })).toHaveCount(0)

  // The renderer still has no Node and the bridge exposes no path/SQL method (full checks in app.spec.ts).
  expect(await win.evaluate(() => typeof (window as unknown as { require?: unknown }).require)).toBe('undefined')
  const methods = await win.evaluate(() => Object.keys((window as unknown as { mindspace: { documents: object } }).mindspace.documents))
  expect(methods.sort()).toEqual(['get', 'getPage', 'importDocuments', 'list', 'rebuildIndex', 'remove', 'reprocess', 'search'])
  expect(errors).toEqual([])
  await app.close()

  expect(paths.map(sha)).toEqual(before)
  expect(readdirSync(join(userData, 'documents'))).toHaveLength(3)
  const db = new Database(join(userData, 'mindspace.sqlite3'), { readonly: true })
  expect(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()).toEqual({ v: 5 })
  expect(db.prepare('SELECT COUNT(*) AS n FROM documents').get()).toEqual({ n: 3 })
  expect(db.prepare("SELECT COUNT(*) AS n FROM document_pages WHERE document_id IN (SELECT id FROM documents WHERE format='pdf')").get()).toEqual({ n: 9 }) // 5 + 2 + 2 (scanned pages stored as empty text)
  db.close()
})
