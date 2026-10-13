/**
 * Keyword-friendly form of a natural-language question. Phase 4 keyword search
 * requires every term to match, so "What is the Atlas budget?" finds nothing
 * even when a note says "Atlas budget". Dropping question and filler words
 * gives the keyword leg of hybrid retrieval a fair chance; it is used only as
 * a fallback when the full question retrieved nothing.
 */
import { queryTerms, searchNormalize } from '@shared/search-text'

const STOP = new Set(
  [
    // English
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'am', 'do', 'does', 'did', 'what', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how',
    'of', 'in', 'on', 'at', 'to', 'for', 'from', 'by', 'with', 'about', 'and', 'or', 'but', 'it', 'its', 'this', 'that', 'these', 'those', 'i', 'me', 'my', 'we',
    'our', 'you', 'your', 'can', 'could', 'should', 'would', 'will', 'tell', 'give', 'show', 'please', 'any', 'there', 'have', 'has', 'had', 'much', 'many',
    // Persian
    'از', 'به', 'در', 'که', 'را', 'با', 'این', 'آن', 'چه', 'چی', 'چیست', 'است', 'هست', 'برای', 'و', 'یا', 'من', 'ما', 'شما', 'آیا', 'چرا', 'چگونه', 'کجا', 'کی',
    'چقدر', 'چند', 'بود', 'شد', 'می', 'هم', 'تا', 'بر', 'های', 'ها', 'درباره', 'مورد'
  ].map((w) => searchNormalize(w))
)

/** Space-joined content words, or null when nothing would change. */
export function contentQuery(question: string): string | null {
  const all = queryTerms(question, 24)
  const kept = all.filter((t) => t.length > 1 && !STOP.has(t))
  if (!kept.length || kept.length === all.length) return null
  return kept.slice(0, 8).join(' ')
}
