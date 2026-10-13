/**
 * Evidence selection. Turns Phase 5 retrieval results into a bounded, deduplicated
 * list of passages with stable ids S1…Sn. The returned AnswerSource list is the
 * ONLY authority for what a citation can point at: it holds the real entity type,
 * record id, title and one-based page of each passage that is sent to the model.
 */
import type { AnswerSource } from '@shared/ai'
import type { RetrievalResult } from '@shared/retrieval'
import { itemUnitText, type SemanticRepo } from '../db/repositories/semantic'

export const PASSAGE_MAX = 1200
const MIN_PASSAGE = 120

export interface EvidenceBudget {
  /** Total characters of passage text allowed. */
  chars: number
  maxSources: number
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

/** A window of `text` around where a keyword snippet came from (or the start when it cannot be found). */
export function windowAround(text: string, snippet: string, max = PASSAGE_MAX): string {
  const flat = text.replace(/[ \t]+/g, ' ').trim()
  if (flat.length <= max) return flat
  const probe = snippet.replace(/…/g, '').replace(/\s+/g, ' ').trim().slice(0, 40)
  const at = probe ? flat.indexOf(probe) : -1
  const start = at < 0 ? 0 : Math.max(0, at - Math.floor(max / 4))
  const slice = flat.slice(start, start + max)
  return `${start > 0 ? '…' : ''}${slice.trim()}${start + max < flat.length ? '…' : ''}`
}

export function selectEvidence(results: readonly RetrievalResult[], repo: SemanticRepo, budget: EvidenceBudget): AnswerSource[] {
  const out: AnswerSource[] = []
  const seen = new Set<string>()
  let used = 0
  for (const r of results) {
    if (out.length >= budget.maxSources) break
    const remaining = budget.chars - used
    if (remaining < MIN_PASSAGE) break

    // Re-read from the authoritative tables; a result whose record vanished is skipped.
    let text: string | null = null
    if (r.chunkId) text = repo.chunk(r.chunkId)?.text ?? null
    const s = r.source
    if (s.type === 'item') {
      const item = repo.item(s.id)
      if (!item) continue
      text = text ?? windowAround(itemUnitText(item), r.excerpt.text)
    } else {
      if (!repo.document(s.id)) continue
      if (text === null) {
        const pageText = s.page !== null ? repo.pageText(s.id, s.page) : (repo.pageText(s.id, 1) ?? null)
        if (pageText === null) continue
        text = windowAround(pageText, r.excerpt.text)
      }
    }
    let passage = text.replace(/\s+/g, ' ').trim()
    if (!passage) continue
    const fingerprint = norm(passage)
    if (seen.has(fingerprint)) continue // identical passage already selected (e.g. a document imported twice)
    if ([...seen].some((x) => x.includes(fingerprint) || fingerprint.includes(x))) continue // overlapping excerpt of the same text
    if (passage.length > Math.min(PASSAGE_MAX, remaining)) passage = `${passage.slice(0, Math.min(PASSAGE_MAX, remaining)).trimEnd()}…`
    seen.add(fingerprint)
    used += passage.length

    const base = { ref: `S${out.length + 1}`, title: s.title, excerpt: passage }
    if (s.type === 'item') out.push({ ...base, kind: 'note', entity: 'item', id: s.id, itemKind: s.itemKind, page: null })
    else out.push({ ...base, kind: s.format === 'pdf' ? 'pdf_page' : 'document', entity: 'document', id: s.id, itemKind: null, page: s.format === 'pdf' ? s.page : null })
  }
  return out
}
