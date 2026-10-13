import type { RetrievalResult } from '@shared/retrieval'
import { documentPath, refPath } from '@/app/navigation'

/** Where a retrieval result opens: the note, or the document at the cited one-based page. */
export function resultPath(r: RetrievalResult, question?: string): string {
  return r.source.type === 'item' ? refPath({ type: 'item', id: r.source.id }) : documentPath(r.source.id, r.source.page ?? undefined, question)
}
