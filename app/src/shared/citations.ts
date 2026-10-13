/**
 * Citation parsing and checking, shared by main (validation, persistence) and
 * renderer (rendering). Markers look like [S1] or [S1, S3]. A marker becomes a
 * link ONLY if its id is in the set of sources supplied for that response;
 * anything else is reported as invalid and is never navigable.
 */
import type { AnswerCheck } from './ai'

export type AnswerSegment = { type: 'text'; text: string } | { type: 'cite'; refs: string[] } | { type: 'invalid'; raw: string }

const MARKER = /\[(S\d{1,3}(?:\s*[,;]\s*S\d{1,3})*)\]/g

export function segmentAnswer(text: string, validRefs: ReadonlySet<string>): AnswerSegment[] {
  const out: AnswerSegment[] = []
  let last = 0
  for (const m of text.matchAll(MARKER)) {
    const start = m.index ?? 0
    if (start > last) out.push({ type: 'text', text: text.slice(last, start) })
    const ids = [...new Set(m[1]!.split(/[,;]/).map((s) => s.trim()))]
    const valid = ids.filter((id) => validRefs.has(id))
    const invalid = ids.filter((id) => !validRefs.has(id))
    if (valid.length) out.push({ type: 'cite', refs: valid })
    for (const id of invalid) out.push({ type: 'invalid', raw: `[${id}]` })
    last = start + m[0].length
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) })
  return out
}

/** Sentence-ish units; a unit that is a bare marker belongs to the previous sentence. */
function sentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?؟۔])\s+(?=[^\s\[])/u))
    .map((s) => s.trim())
    .filter(Boolean)
}

const WORD = /[\p{L}\p{N}]+/gu

/** A sentence that asserts something: enough words, not a question, not a heading/list label. */
function isStatement(s: string): boolean {
  const stripped = s.replace(MARKER, '').trim()
  if (/[?؟]$/.test(stripped) || /:$/.test(stripped)) return false
  return (stripped.match(WORD)?.length ?? 0) >= 5
}

export function checkAnswer(text: string, validRefs: ReadonlySet<string>): AnswerCheck {
  const segs = segmentAnswer(text, validRefs)
  const valid = new Set<string>()
  const invalid = new Set<string>()
  let validCount = 0
  for (const s of segs) {
    if (s.type === 'cite') {
      validCount += s.refs.length
      s.refs.forEach((r) => valid.add(r))
    }
    if (s.type === 'invalid') invalid.add(s.raw.slice(1, -1))
  }
  // A marker that is not in the supplied source set does not count as a citation.
  const uncited = sentences(text).filter((s) => isStatement(s) && !segmentAnswer(s, validRefs).some((g) => g.type === 'cite')).length
  return { validCitations: validCount, invalidCitations: [...invalid], uncitedSentences: uncited }
}

/** Source ids actually cited with a valid marker, in order of first use. */
export function citedRefs(text: string, validRefs: ReadonlySet<string>): string[] {
  const seen: string[] = []
  for (const s of segmentAnswer(text, validRefs)) if (s.type === 'cite') for (const r of s.refs) if (!seen.includes(r)) seen.push(r)
  return seen
}

/** Removes citation markers (used when earlier answers are replayed as conversation context). */
export function stripCitations(text: string): string {
  return text.replace(MARKER, '').replace(/[ \t]+([.,;:!?])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim()
}
