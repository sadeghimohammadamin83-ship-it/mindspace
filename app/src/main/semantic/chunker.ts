/**
 * Source-aware chunking. Chunks are character ranges [start, end) of ONE
 * source unit (a note's text, or one PDF page / text document), so every
 * chunk maps back to exact stored text and, for PDFs, to exactly one page.
 * Pages are never merged. Boundaries prefer headings, then paragraphs, then
 * sentences (Latin and Persian punctuation), then whitespace.
 */

export interface ChunkOptions {
  /** Upper bound in characters. ~900 chars stays well under e5's 512-token limit for Persian and English. */
  maxChars: number
  /** Context repeated between consecutive pieces of one long paragraph. */
  overlapChars: number
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { maxChars: 900, overlapChars: 150 }

export interface ChunkRange {
  start: number
  end: number
}

interface Block extends ChunkRange {
  heading: boolean
}

const HAS_CONTENT = /[\p{L}\p{N}]/u
const HEADING = /^\s{0,3}#{1,6}\s/

/** Paragraph blocks: separated by blank lines; a Markdown heading line is its own block. */
function blocks(text: string): Block[] {
  const out: Block[] = []
  let start = -1
  let end = -1
  const flush = () => {
    if (start >= 0) out.push({ start, end, heading: false })
    start = -1
  }
  let pos = 0
  for (const line of text.split('\n')) {
    const lineStart = pos
    const lineEnd = pos + line.length
    pos = lineEnd + 1
    const trimmed = line.trim()
    if (!trimmed) {
      flush()
      continue
    }
    const s = lineStart + line.indexOf(trimmed)
    const e = s + trimmed.length
    if (HEADING.test(line)) {
      flush()
      out.push({ start: s, end: e, heading: true })
      continue
    }
    if (start < 0) start = s
    end = e
  }
  flush()
  return out
}

/** Sentence ranges inside [start, end). */
function sentences(text: string, start: number, end: number): ChunkRange[] {
  const out: ChunkRange[] = []
  const re = /[.!?؟؛…]+["'»”)\]]*\s+|\n+/gu
  re.lastIndex = start
  let s = start
  const slice = text.slice(0, end)
  for (let m = re.exec(slice); m; m = re.exec(slice)) {
    const e = m.index + m[0].trimEnd().length
    if (e > s) out.push({ start: s, end: e })
    s = m.index + m[0].length
  }
  if (s < end) out.push({ start: s, end })
  return out.filter((r) => text.slice(r.start, r.end).trim().length > 0).map((r) => trim(text, r))
}

function trim(text: string, r: ChunkRange): ChunkRange {
  let { start, end } = r
  while (start < end && /\s/.test(text[start]!)) start++
  while (end > start && /\s/.test(text[end - 1]!)) end--
  return { start, end }
}

/** Splits an over-long sentence at whitespace (or hard, as a last resort), with overlap. */
function hardSplit(text: string, r: ChunkRange, o: ChunkOptions): ChunkRange[] {
  const out: ChunkRange[] = []
  let s = r.start
  while (s < r.end) {
    let e = Math.min(r.end, s + o.maxChars)
    if (e < r.end) {
      const space = text.lastIndexOf(' ', e)
      if (space > s + o.maxChars / 2) e = space
    }
    out.push(trim(text, { start: s, end: e }))
    if (e >= r.end) break
    let next = Math.max(e - o.overlapChars, s + 1)
    const space = text.indexOf(' ', next)
    if (space > 0 && space < e) next = space + 1
    s = next
  }
  return out
}

/** Packs the sentences of one long block into windows; consecutive windows share up to `overlapChars` of whole sentences. */
function splitLong(text: string, block: ChunkRange, o: ChunkOptions): ChunkRange[] {
  const units = sentences(text, block.start, block.end).flatMap((s) => (s.end - s.start > o.maxChars ? hardSplit(text, s, o) : [s]))
  const out: ChunkRange[] = []
  let i = 0
  while (i < units.length) {
    let j = i
    while (j + 1 < units.length && units[j + 1]!.end - units[i]!.start <= o.maxChars) j++
    out.push({ start: units[i]!.start, end: units[j]!.end })
    if (j + 1 >= units.length) break
    // Step back over trailing sentences that fit in the overlap budget, but always advance.
    let k = j + 1
    while (k - 1 > i && units[j]!.end - units[k - 1]!.start <= o.overlapChars) k--
    i = k
  }
  return out
}

export function chunkText(text: string, options: Partial<ChunkOptions> = {}): ChunkRange[] {
  const o = { ...DEFAULT_CHUNK_OPTIONS, ...options }
  if (o.maxChars < 50 || o.overlapChars < 0 || o.overlapChars >= o.maxChars / 2) throw new Error('invalid chunk options')
  const out: ChunkRange[] = []
  let cur: ChunkRange | null = null
  for (const b of blocks(text)) {
    // A heading always opens a new chunk, so it stays with the text it introduces.
    if (b.heading) {
      if (cur) out.push(cur)
      cur = { start: b.start, end: b.end }
      continue
    }
    if (b.end - b.start > o.maxChars) {
      const pieces = splitLong(text, b, o)
      if (cur) {
        if (pieces[0]!.end - cur.start <= o.maxChars) pieces[0] = { start: cur.start, end: pieces[0]!.end }
        else out.push(cur)
        cur = null
      }
      out.push(...pieces)
      continue
    }
    if (cur && b.end - cur.start <= o.maxChars) cur.end = b.end
    else {
      if (cur) out.push(cur)
      cur = { start: b.start, end: b.end }
    }
  }
  if (cur) out.push(cur)
  // No empty or punctuation-only chunks; no exact duplicates within one unit.
  const seen = new Set<string>()
  return out.filter((r) => {
    const t = text.slice(r.start, r.end)
    if (r.end <= r.start || !HAS_CONTENT.test(t) || seen.has(t)) return false
    seen.add(t)
    return true
  })
}
