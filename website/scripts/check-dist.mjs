// Verifies every local asset/link referenced by dist/index.html exists, and that no third-party hosts are referenced.
import { readFileSync, existsSync } from 'node:fs'
const base = process.env.SITE_BASE ?? '/mindspace/'
const html = readFileSync('dist/index.html', 'utf8')
let bad = 0
for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const u = m[1]
  if (u.startsWith('http')) { if (!u.includes('sadeghimohammadamin83-ship-it')) { console.error('external:', u); bad++ } continue }
  if (u.startsWith('#')) continue
  if (!u.startsWith(base)) { console.error('bad base:', u); bad++; continue }
  if (!existsSync('dist/' + u.slice(base.length))) { console.error('missing:', u); bad++ }
}
for (const f of ['404.html', 'og.png', 'favicon.svg', 'screens/dashboard-en.webp']) if (!existsSync('dist/' + f)) { console.error('missing', f); bad++ }
if (bad) process.exit(1)
console.log('dist check ok')
