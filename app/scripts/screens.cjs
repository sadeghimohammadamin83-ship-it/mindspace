// Captures every screen of the built app (dev aid; run under a display, e.g. xvfb-run).
// Usage: node scripts/screens.cjs <outDir> [width] [height] [lang]
const { _electron } = require('playwright-core')
const path = require('node:path')
const [outDir = 'test-results/screens', width = '1440', height = '900', lang = 'fa'] = process.argv.slice(2)
const routes = [
  '/', '/capture', '/library', '/projects', '/projects/proj-thesis', '/tasks', '/ask', '/briefing', '/settings',
  '/projects/proj-mindspace', '/projects/proj-mindspace?tab=notes', '/projects/proj-mindspace?tab=decisions',
  '/projects/proj-mindspace?tab=decisions&decision=dec-sqlite', '/projects/proj-mindspace?tab=activity', '/decisions', '/tags'
]

;(async () => {
  const app = await _electron.launch({ args: [path.resolve(__dirname, '..')] })
  const win = await app.firstWindow()
  const errors = []
  win.on('pageerror', (e) => errors.push(e.message))
  win.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const bw = BrowserWindow.getAllWindows()[0]
    bw.setContentSize(w, h)
  }, [Number(width), Number(height)])
  await win.waitForSelector('h1')
  if (lang === 'en') {
    await win.evaluate(() => (location.hash = '#/settings'))
    await win.getByRole('radio', { name: 'English' }).first().click()
  }
  for (const r of routes) {
    await win.evaluate((h) => (location.hash = '#' + h), r)
    await win.waitForTimeout(500)
    const name = (r === '/' ? 'dashboard' : r.slice(1).replace(/[/?&=]/g, '-')) + `-${lang}-${width}x${height}.png`
    await win.screenshot({ path: path.join(outDir, name) })
  }
  console.log('errors:', JSON.stringify(errors))
  await app.close()
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
