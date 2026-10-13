import type { Snippet } from '@shared/documents'
import { normalizeMapped, queryTerms } from '@shared/search-text'

/** Renders a snippet as plain text with <mark> ranges. Content is never parsed as HTML. */
export function SnippetText({ snippet, className }: { snippet: Snippet; className?: string }) {
  const parts: { text: string; mark: boolean }[] = []
  let at = 0
  for (const [s, e] of snippet.marks) {
    if (s < at || e > snippet.text.length) continue
    if (s > at) parts.push({ text: snippet.text.slice(at, s), mark: false })
    parts.push({ text: snippet.text.slice(s, e), mark: true })
    at = e
  }
  if (at < snippet.text.length) parts.push({ text: snippet.text.slice(at), mark: false })
  return (
    <span className={className} dir="auto">
      {parts.map((p, i) =>
        p.mark ? (
          <mark key={i} className="rounded-xs bg-accent-soft px-0.5 text-accent-text">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </span>
  )
}

/** Marks every occurrence of the query terms in `text` (same normalisation as the index). */
export function highlightRanges(text: string, query: string): [number, number][] {
  const terms = queryTerms(query)
  if (!terms.length) return []
  const { text: norm, map } = normalizeMapped(text)
  const out: [number, number][] = []
  for (const t of terms) {
    let i = norm.indexOf(t)
    while (i >= 0) {
      const last = map[i + t.length - 1]!
      out.push([map[i]!, last + (text.codePointAt(last)! > 0xffff ? 2 : 1)])
      i = norm.indexOf(t, i + t.length)
    }
  }
  return out.sort((a, b) => a[0] - b[0]).filter((m, i, arr) => i === 0 || m[0] >= arr[i - 1]![1])
}
