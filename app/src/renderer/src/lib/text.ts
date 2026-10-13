import { normalizeText } from '@shared/text'

export { normalizeText }

const STOPWORDS = new Set([
  // English
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'was', 'were', 'be',
  'what', 'which', 'who', 'how', 'when', 'where', 'why', 'did', 'do', 'does', 'i', 'my', 'me',
  'about', 'with', 'from', 'that', 'this', 'it', 'we', 'our', 'you', 'your', 'have', 'has', 'had',
  // Persian
  'و', 'در', 'به', 'از', 'که', 'را', 'با', 'این', 'آن', 'برای', 'چه', 'چی', 'چیست', 'کدام', 'من',
  'است', 'بود', 'هست', 'شد', 'کرد', 'کردم', 'گرفتم', 'مورد', 'درباره', 'یک', 'هم', 'تا', 'ما',
  'بر', 'یا', 'اما', 'چرا', 'کی', 'کجا', 'چطور', 'آیا', 'ها', 'های', 'می', 'شده', 'دارم', 'باید'
])

/** Splits a question into searchable terms, dropping very short words and stopwords. */
export function searchTerms(input: string): string[] {
  const terms = normalizeText(input)
    .split(/[^\p{L}\p{N}@.+#-]+/u)
    .map((t) => t.replace(/^[.\-#]+|[.\-]+$/g, ''))
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
  return [...new Set(terms)]
}

/** Returns a short excerpt of `text` centred on the first occurrence of `query`. */
export function excerpt(text: string, query: string, radius = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const q = normalizeText(query)
  if (!q) return flat.slice(0, radius * 2)
  const idx = normalizeText(flat).indexOf(q)
  if (idx < 0) return flat.slice(0, radius * 2) + (flat.length > radius * 2 ? '…' : '')
  const start = Math.max(0, idx - radius)
  const end = Math.min(flat.length, idx + q.length + radius)
  return (start > 0 ? '…' : '') + flat.slice(start, end) + (end < flat.length ? '…' : '')
}
