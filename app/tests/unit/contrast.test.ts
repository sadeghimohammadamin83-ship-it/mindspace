import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync('src/renderer/src/design-system/tokens.css', 'utf8')
const token = (n: string) => new RegExp(`--color-${n}:\\s*(#[0-9a-f]{6})`).exec(css)?.[1] ?? ''
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
}
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x! + 0.05) / (y! + 0.05)
}

describe('WCAG AA text contrast (4.5:1)', () => {
  const surfaces = ['canvas', 'sidebar', 'surface', 'raised', 'hover']
  const texts = ['fg', 'fg-muted', 'fg-subtle', 'accent-text', 'success', 'info', 'warning', 'danger']
  for (const s of surfaces)
    for (const t of texts)
      it(`${t} on ${s}`, () => expect(ratio(token(t), token(s))).toBeGreaterThanOrEqual(4.5))
  it('primary button text on accent', () => expect(ratio(token('accent-fg'), token('accent'))).toBeGreaterThanOrEqual(4.5))
})
