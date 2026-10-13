// Writes release/SHA256SUMS.txt and release/release-manifest.json from the files actually present in release/.
const { createHash } = require('node:crypto')
const { readFileSync, readdirSync, statSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const pkg = require('../package.json')
const dir = join(__dirname, '..', 'release')
const files = readdirSync(dir).filter((f) => /^MINDSPACE-.*\.exe$/.test(f))
if (files.length === 0) throw new Error('No MINDSPACE-*.exe in release/ - nothing to record')
const artifacts = files.map((name) => {
  const size = statSync(join(dir, name)).size
  if (size === 0) throw new Error(`${name} is empty`)
  return { name, bytes: size, sha256: createHash('sha256').update(readFileSync(join(dir, name))).digest('hex') }
})
writeFileSync(join(dir, 'SHA256SUMS.txt'), artifacts.map((a) => `${a.sha256}  ${a.name}`).join('\n') + '\n')
writeFileSync(join(dir, 'release-manifest.json'), JSON.stringify({ product: 'MINDSPACE', version: pkg.version, platform: 'win32', arch: 'x64', signed: false, artifacts }, null, 2) + '\n')
console.log(artifacts.map((a) => `${a.sha256}  ${a.bytes}  ${a.name}`).join('\n'))
