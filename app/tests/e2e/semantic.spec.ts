import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import Database from 'better-sqlite3'
import { copyFileSync, cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Phase 5 in the real built app (main process, embedding worker thread,
 * preload bridge, renderer). Synthetic fixtures only; only the OS file
 * dialog is stubbed. The second test needs the real model files:
 *   MINDSPACE_TEST_MODEL_DIR=<pinned model folder>
 * and is SKIPPED without them.
 */
const FIX = resolve(__dirname, '../fixtures/documents')
const MODEL_DIR = process.env['MINDSPACE_TEST_MODEL_DIR']
const temp: string[] = []
const mk = (p: string) => {
  const d = mkdtempSync(join(tmpdir(), p))
  temp.push(d)
  return d
}
test.afterAll(() => temp.forEach((d) => rmSync(d, { recursive: true, force: true })))

const launch = (userData: string, modelDir: string) =>
  electron.launch({
    args: [resolve(__dirname, '../..')],
    env: { ...process.env, MINDSPACE_USER_DATA_DIR: userData, MINDSPACE_MODEL_DIR: modelDir }
  })

async function stubDialog(app: ElectronApplication, paths: string[]) {
  await app.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: files })) as typeof dialog.showOpenDialog
  }, paths)
}

async function english(win: Page) {
  await win.evaluate(() => (location.hash = '#/settings'))
  await win.getByRole('radio', { name: 'English' }).first().click()
}

async function importSemanticPdf(app: ElectronApplication, win: Page) {
  const src = mk('mindspace-src-')
  copyFileSync(join(FIX, 'sample-semantic.pdf'), join(src, 'sample-semantic.pdf'))
  await win.evaluate(() => (location.hash = '#/documents'))
  await stubDialog(app, [join(src, 'sample-semantic.pdf')])
  await win.getByRole('button', { name: 'Import documents' }).first().click()
  await expect(win.getByText('Searchable', { exact: true })).toHaveCount(1, { timeout: 30_000 })
}

/**
 * Phase 6 turned the Ask page into grounded answers, which need a language model. The
 * retrieval stage that feeds it is the same service, so it is exercised through the bridge.
 */
async function retrieve(win: Page, text: string, mode: 'hybrid' | 'semantic' | 'keyword') {
  return win.evaluate(
    async ({ text, mode }) => {
      const r = await (window as unknown as { mindspace: { retrieval: { retrieve(q: unknown): Promise<{ ok: boolean; value: { semantic: string; results: { methods: string[]; excerpt: { text?: string }; source: { page?: number | null; title: string } }[] } }> } } }).mindspace.retrieval.retrieve({ text, mode, limit: 5 })
      if (!r.ok) throw new Error('retrieve failed')
      return { semantic: r.value.semantic, results: r.value.results.map((x) => ({ page: x.source.page ?? null, methods: x.methods, excerpt: JSON.stringify(x.excerpt), title: x.source.title })) }
    },
    { text, mode }
  )
}

test('without the model: clear setup state, keyword evidence still works, setup failure is reported', async () => {
  const userData = mk('mindspace-sem-a-')
  const emptyModel = mk('mindspace-model-empty-')
  const app = await launch(userData, emptyModel)
  const win = await app.firstWindow()
  await win.waitForSelector('h1')
  await english(win)
  const errors: string[] = []
  win.on('pageerror', (e) => errors.push(String(e)))

  const panel = win.getByRole('region', { name: 'Semantic search' })
  await expect(panel.getByText('Not set up')).toBeVisible()
  await expect(panel.getByText(/never leave this computer/)).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Download and set up' })).toBeEnabled()

  await importSemanticPdf(app, win)
  const kw = await retrieve(win, 'snow tyres', 'hybrid')
  expect(kw.semantic).toBe('model_unavailable')
  expect(kw.results[0]!.page).toBe(2)
  expect(kw.results[0]!.methods).toEqual(['keyword'])

  // Semantic-only mode never invents results without the model.
  const none = await retrieve(win, 'replacing brakes before a snowy journey', 'semantic')
  expect(none.results).toEqual([])

  // Explicit setup. This container cannot reach Hugging Face, so the download must fail cleanly.
  await win.evaluate(() => (location.hash = '#/settings'))
  await panel.getByRole('button', { name: 'Download and set up' }).click()
  await expect(panel.getByText('Problem')).toBeVisible({ timeout: 30_000 })
  await expect(panel.getByRole('button', { name: 'Try again' })).toBeVisible()
  expect(existsSync(join(emptyModel, 'onnx', 'model_quantized.onnx'))).toBe(false)
  expect(errors).toEqual([])
  await app.close()
})

test('with the real local model: explicit setup, indexing in the worker, cited evidence, restart', async () => {
  test.skip(!MODEL_DIR, 'MINDSPACE_TEST_MODEL_DIR not set: real-model E2E skipped')
  test.setTimeout(180_000)
  const userData = mk('mindspace-sem-b-')
  // A copy without the verification marker: the app must verify checksums before using it.
  const modelDir = join(mk('mindspace-model-'), 'm')
  cpSync(MODEL_DIR!, modelDir, { recursive: true })
  rmSync(join(modelDir, '.verified.json'), { force: true })

  let app = await launch(userData, modelDir)
  let win = await app.firstWindow()
  await win.waitForSelector('h1')
  await english(win)
  const errors: string[] = []
  win.on('pageerror', (e) => errors.push(String(e)))

  const panel = win.getByRole('region', { name: 'Semantic search' })
  await expect(panel.getByText('Not set up')).toBeVisible()
  const t0 = Date.now()
  await panel.getByRole('button', { name: 'Download and set up' }).click()
  await expect(panel.getByText('Ready')).toBeVisible({ timeout: 60_000 })
  console.info(`[e2e] verify + load model: ${Date.now() - t0} ms`)

  await importSemanticPdf(app, win)
  await win.evaluate(() => (location.hash = '#/settings'))
  await expect(panel.getByText(/Up to date/)).toBeVisible({ timeout: 60_000 })

  // Ask Your Memory: a paraphrase with none of the page's key words → page 2.
  const t1 = Date.now()
  const sem = await retrieve(win, 'replacing brakes on my vehicle before a snowy journey', 'semantic')
  console.info(`[e2e] semantic question to evidence: ${Date.now() - t1} ms`)
  expect(sem.results[0]!.page).toBe(2)
  expect(sem.results[0]!.methods).toContain('semantic')
  expect(sem.results[0]!.excerpt).toMatch(/snow tyres/)
  await expect(win.getByTestId('document-text')).toContainText('the automobile needs new snow tyres')

  // Global search: meaning-based group.
  await win.getByRole('combobox', { name: 'Global search' }).fill('insomnia and caffeine')
  await expect(win.getByRole('group', { name: 'Related by meaning' }).getByRole('option', { name: /sample-semantic.*Page 3/ })).toBeVisible({ timeout: 10_000 })
  expect(errors).toEqual([])
  await app.close()

  const read = () => {
    const db = new Database(join(userData, 'mindspace.sqlite3'), { readonly: true })
    const rows = db.prepare('SELECT id, page, created_at FROM semantic_chunks ORDER BY id').all()
    const version = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()
    db.close()
    return { rows, version }
  }
  const before = read()
  expect(before.version).toEqual({ v: 4 })
  expect(before.rows.length).toBeGreaterThan(0)

  // Restart: the verified model loads by itself (no download, no click); nothing is re-embedded.
  app = await launch(userData, modelDir)
  win = await app.firstWindow()
  await win.waitForSelector('h1')
  await win.evaluate(() => (location.hash = '#/settings'))
  await expect(win.getByRole('region', { name: 'Semantic search' }).getByText('Ready')).toBeVisible({ timeout: 60_000 })
  const again = await retrieve(win, 'insomnia and caffeine', 'semantic')
  expect(again.results[0]!.page).toBe(3)
  await app.close()
  expect(read().rows).toEqual(before.rows)
})
