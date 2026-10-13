import { _electron as electron, expect, test } from '@playwright/test'
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/**
 * Release smoke test against a PACKAGED build (asar + unpacked natives), not the repository.
 * Runs only when MINDSPACE_PACKAGED_EXE points at the unpacked app executable. Packaged builds
 * ignore MINDSPACE_USER_DATA_DIR, so the profile is isolated through HOME / XDG_CONFIG_HOME instead.
 * CI on Linux checks the Linux package; the Windows installer itself needs a manual Windows run.
 */
const exe = process.env['MINDSPACE_PACKAGED_EXE']
const FIX = resolve(__dirname, '../fixtures/documents')
test.skip(!exe, 'set MINDSPACE_PACKAGED_EXE to a packaged executable')

test('packaged app: starts, stores data outside the install dir, imports + searches a PDF, persists', async () => {
  const home = mkdtempSync(join(tmpdir(), 'mindspace-pkg-'))
  const sources = mkdtempSync(join(tmpdir(), 'mindspace-pkg-src-'))
  copyFileSync(join(FIX, 'sample-multipage.pdf'), join(sources, 'sample-multipage.pdf'))
  const launch = () =>
    electron.launch({
      executablePath: exe!,
      args: ['--no-sandbox'],
      env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), ELECTRON_RENDERER_URL: 'http://localhost:1' }
    })
  try {
    let app = await launch()
    const info = await app.evaluate(({ app: a }) => ({ packaged: a.isPackaged, name: a.getName(), version: a.getVersion(), data: a.getPath('userData') }))
    expect(info.packaged).toBe(true)
    expect(info.name).toBe('MINDSPACE')
    expect(info.data.startsWith(home)).toBe(true)
    expect(info.data.startsWith(dirname(exe!))).toBe(false)
    let win = await app.firstWindow()
    await win.waitForSelector('h1')
    expect(win.url()).toMatch(/^app:\/\//) // the packaged renderer, never the dev-server URL
    await win.evaluate(() => (location.hash = '#/settings'))
    await win.getByRole('radio', { name: 'English' }).first().click()
    await win.getByRole('link', { name: 'Dashboard' }).click()
    await win.getByRole('button', { name: 'Capture', exact: true }).click()
    const dlg = win.getByRole('dialog')
    await dlg.getByLabel('Title').fill('Packaged smoke note')
    await dlg.getByRole('button', { name: 'Save capture' }).click()
    await expect(dlg).toBeHidden()

    await app.evaluate(({ dialog }, files) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: files })) as typeof dialog.showOpenDialog
    }, [join(sources, 'sample-multipage.pdf')])
    await win.getByRole('link', { name: 'Documents' }).click()
    await win.getByRole('button', { name: 'Import documents' }).first().click()
    await expect(win.getByText('1 imported')).toBeVisible()
    await expect(win.getByText('Searchable', { exact: true })).toHaveCount(1, { timeout: 30_000 }) // pdf.js worker extracted text
    const box = win.getByRole('combobox', { name: 'Global search' })
    await box.fill('zephyr quartz')
    await expect(win.getByRole('option', { name: /sample-multipage.*Page 3/ })).toBeVisible() // pdf.js worker + FTS5
    expect(existsSync(join(info.data, 'mindspace.sqlite3'))).toBe(true)
    expect(readdirSync(join(info.data, 'documents'))).toHaveLength(1)
    await app.close()

    app = await launch()
    win = await app.firstWindow()
    await win.waitForSelector('h1')
    await win.evaluate(() => (location.hash = '#/documents'))
    await win.getByRole('combobox', { name: 'Global search' }).fill('zephyr quartz')
    await expect(win.getByRole('option', { name: /sample-multipage.*Page 3/ })).toBeVisible()
    await win.getByRole('combobox', { name: 'Global search' }).fill('Packaged smoke note')
    await expect(win.getByRole('option', { name: /Packaged smoke note/ }).first()).toBeVisible()
    await app.close()
  } finally {
    rmSync(home, { recursive: true, force: true })
    rmSync(sources, { recursive: true, force: true })
  }
})
