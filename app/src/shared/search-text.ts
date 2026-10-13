/**
 * Search normalisation with an offset map back to the original text, so the
 * index can store normalised text (Persian yeh/kaf, digits, diacritics,
 * ZWNJ, case, NFKC presentation forms) while snippets are cut from the
 * ORIGINAL text. Stored document text itself is never modified.
 */
import { normalizeText } from './text'

export interface MappedText {
  text: string
  /** map[i] = index in the original string of normalised char i */
  map: number[]
}

export function normalizeMapped(input: string): MappedText {
  let text = ''
  const map: number[] = []
  let lastSpace = true
  let i = 0
  for (const ch of input) {
    const at = i
    i += ch.length
    if (/\s/u.test(ch) || ch === '‌' || ch === '‍') {
      if (!lastSpace) {
        text += ' '
        map.push(at)
        lastSpace = true
      }
      continue
    }
    const out = normalizeText(ch.normalize('NFKC'))
    for (const c of out) {
      if (c === ' ') {
        if (lastSpace) continue
        lastSpace = true
      } else lastSpace = false
      text += c
      for (let k = 0; k < c.length; k++) map.push(at)
    }
  }
  if (text.endsWith(' ')) {
    text = text.slice(0, -1)
    map.pop()
  }
  return { text, map }
}

const ASCII_ONLY = /^[\x00-\x7f]*$/

/**
 * Index/query normalisation. Pure-ASCII text (English documents) takes a
 * direct path that gives the same result as the char-by-char mapper without
 * building the offset map, which the index never needs (measured ~10x faster).
 */
export function searchNormalize(s: string): string {
  if (ASCII_ONLY.test(s)) return s.toLocaleLowerCase().replace(/\s+/g, ' ').trim()
  return normalizeMapped(s).text
}

/** Query terms: letters/digits runs of the normalised query, deduplicated. */
export function queryTerms(query: string, max = 12): string[] {
  const terms = searchNormalize(query)
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .filter(Boolean)
  return [...new Set(terms)].slice(0, max)
}
