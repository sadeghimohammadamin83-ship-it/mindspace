import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type Ref } from 'react'
import { useNavigate } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { CornerDownLeft, FolderKanban, Search, SearchX, Sparkles, X } from 'lucide-react'
import { Kbd } from '@/design-system/components'
import { TRANSITION } from '@/design-system/motion'
import { KindIcon } from '@/features/shared/meta'
import { cn } from '@/lib/cn'
import { useI18n } from '@/state/preferences'
import { useWorkspace } from '@/state/workspace'
import { globalSearch, type SearchHit } from '@/state/selectors'
import { documentPath, refPath } from './navigation'
import type { SearchResult } from '@shared/documents'
import { unwrapResult, useDocumentsApi } from '@/state/documents'
import { FormatIcon } from '@/features/documents/meta'
import { SnippetText } from '@/features/documents/SnippetText'
import { resultPath } from '@/features/ask/resultPath'
import { useRetrievalApi } from '@/state/retrieval'
import type { RetrievalResult } from '@shared/retrieval'

type DocHit = Extract<SearchResult, { type: 'page' | 'document' }>

/** Sliding highlight shared by all options, so moving the selection glides instead of jumping. */
function Highlight() {
  return <motion.span layoutId="search-highlight" transition={TRANSITION.fast} aria-hidden className="absolute inset-0 rounded-md bg-hover" />
}

type Option = { kind: 'hit'; hit: SearchHit } | { kind: 'doc'; hit: DocHit } | { kind: 'sem'; hit: RetrievalResult } | { kind: 'all' }

/**
 * Top-bar search across knowledge, projects and tasks (combobox pattern).
 * Enter opens the highlighted record; the last option opens the library.
 */
export function GlobalSearch({ inputRef }: { inputRef: Ref<HTMLInputElement> }) {
  const { t, fmt } = useI18n()
  const { data } = useWorkspace()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  const docsApi = useDocumentsApi()
  const [docHits, setDocHits] = useState<DocHit[]>([])
  const results = useMemo(() => globalSearch(data, query), [data, query])
  const retrievalApi = useRetrievalApi()
  const [semHits, setSemHits] = useState<RetrievalResult[]>([])

  // Meaning-based matches (local embedding model) for wording the keyword groups miss.
  // Longer debounce than keyword search; answers for an outdated query are dropped.
  useEffect(() => {
    const text = query.trim()
    if (!retrievalApi || text.length < 3) {
      setSemHits([])
      return
    }
    let stale = false
    const timer = setTimeout(() => {
      unwrapResult(retrievalApi.retrieve({ text, mode: 'semantic', limit: 5 })).then(
        (r) => !stale && setSemHits(r.results),
        () => !stale && setSemHits([])
      )
    }, 300)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [retrievalApi, query])

  // Document text lives in the main-process FTS index: debounce, and drop answers for an outdated query.
  useEffect(() => {
    const text = query.trim()
    if (!docsApi || text.length < 2) {
      setDocHits([])
      return
    }
    let stale = false
    const timer = setTimeout(() => {
      unwrapResult(docsApi.search({ text, scopes: ['document'], limit: 6 })).then(
        (r) => !stale && setDocHits(r.results.filter((x): x is DocHit => x.type !== 'item')),
        () => !stale && setDocHits([])
      )
    }, 150)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [docsApi, query])
  const groups = [
    { label: t.search.groupItems, hits: results.items },
    { label: t.search.groupProjects, hits: results.projects },
    { label: t.search.groupTasks, hits: results.tasks }
  ].filter((g) => g.hits.length > 0)
  // Only sources the keyword groups do not already show.
  const shown = new Set([
    ...results.items.map((h) => `item:${h.ref.id}`),
    ...docHits.map((h) => (h.type === 'page' ? `page:${h.id}:${h.page}` : `doc:${h.id}`))
  ])
  const related = semHits.filter((h) => !shown.has(h.key) && !(h.source.type === 'item' && shown.has(`item:${h.source.id}`))).slice(0, 4)
  const options: Option[] = [
    ...groups.flatMap((g) => g.hits.map((hit) => ({ kind: 'hit' as const, hit }))),
    ...docHits.map((hit) => ({ kind: 'doc' as const, hit })),
    ...related.map((hit) => ({ kind: 'sem' as const, hit })),
    { kind: 'all' }
  ]
  const showPanel = open && query.trim().length > 0

  useEffect(() => setActive(0), [query])
  useEffect(() => {
    if (!showPanel) return
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [showPanel])

  const choose = (option: Option | undefined) => {
    if (!option) return
    const target =
      option.kind === 'hit'
        ? refPath(option.hit.ref)
        : option.kind === 'doc'
          ? documentPath(option.hit.id, option.hit.type === 'page' ? option.hit.page : undefined, query.trim())
          : option.kind === 'sem'
            ? resultPath(option.hit)
            : `/library?q=${encodeURIComponent(query.trim())}`
    navigate(target)
    setOpen(false)
    setQuery('')
    if (option.kind !== 'all') (document.activeElement as HTMLElement | null)?.blur()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((i) => (i + 1) % options.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + options.length) % options.length)
    } else if (e.key === 'Enter' && showPanel) {
      e.preventDefault()
      choose(options[active])
    } else if (e.key === 'Escape') {
      if (query) {
        e.preventDefault()
        setQuery('')
      } else {
        e.currentTarget.blur()
      }
      setOpen(false)
    }
  }

  const optionId = (i: number) => `${listId}-opt-${i}`
  let index = -1

  return (
    <div ref={rootRef} className="relative w-full max-w-[440px] min-w-0">
      <Search size={15} strokeWidth={1.75} aria-hidden className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        dir="auto"
        aria-label={t.topbar.searchLabel}
        aria-expanded={showPanel}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showPanel ? optionId(active) : undefined}
        aria-keyshortcuts="Control+K"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={t.topbar.searchPlaceholder}
        className={cn(
          'h-8.5 w-full rounded-lg border border-line-subtle bg-surface ps-9 pe-16 text-base text-fg transition-colors',
          'placeholder:text-fg-subtle hover:border-line focus-visible:border-accent-line focus-visible:bg-raised focus-visible:ring-3 focus-visible:ring-accent-soft focus-visible:outline-none',
          '[&::-webkit-search-cancel-button]:hidden'
        )}
      />
      <div className="absolute end-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
        {query ? (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label={t.common.clear}
            className="rounded-sm p-1 text-fg-subtle hover:text-fg"
          >
            <X size={13} aria-hidden />
          </button>
        ) : (
          <span className="flex items-center gap-0.5" dir="ltr" aria-hidden>
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd>
          </span>
        )}
      </div>

      <AnimatePresence>
      {showPanel && (
      <motion.div
        id={listId}
        role="listbox"
        aria-label={t.topbar.searchLabel}
        initial={{ opacity: 0, y: -4, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1, transition: TRANSITION.base }}
        exit={{ opacity: 0, y: -2, transition: TRANSITION.fast }}
        className="absolute inset-x-0 top-full z-40 mt-1.5 max-h-[min(520px,70vh)] origin-top overflow-y-auto rounded-xl border border-line bg-raised p-1.5 shadow-lg"
      >
        {showPanel && groups.length === 0 && docHits.length === 0 && related.length === 0 && (
          <div className="flex flex-col items-center gap-1.5 px-4 py-6 text-center">
            <SearchX size={18} strokeWidth={1.5} className="text-fg-subtle" aria-hidden />
            <p className="text-sm text-fg">{t.search.noResults(query.trim())}</p>
            <p className="text-xs text-fg-subtle">{t.search.noResultsHint}</p>
          </div>
        )}
        {groups.map((g) => (
          <div key={g.label} role="group" aria-label={g.label} className="mb-1">
            <p className="px-2.5 pt-1.5 pb-1 text-2xs font-semibold tracking-wide text-fg-subtle uppercase" aria-hidden>
              {g.label}
            </p>
            {g.hits.map((hit) => {
              index += 1
              const i = index
              return (
                <div
                  key={`${hit.ref.type}-${hit.ref.id}`}
                  id={optionId(i)}
                  role="option"
                  aria-selected={active === i}
                  onPointerMove={() => setActive(i)}
                  onClick={() => choose({ kind: 'hit', hit })}
                  className="relative flex cursor-default items-start gap-2.5 rounded-md px-2.5 py-2"
                >
                  {active === i && <Highlight />}
                  <span className="relative mt-0.5">
                    {hit.kind === 'project' ? (
                      <FolderKanban size={15} strokeWidth={1.75} className="text-fg-subtle" aria-hidden />
                    ) : (
                      <KindIcon kind={hit.kind} />
                    )}
                  </span>
                  <span className="relative min-w-0 flex-1">
                    <span className="block truncate text-base text-fg" dir="auto">
                      {hit.title}
                    </span>
                    {hit.snippet && (
                      <span className="block truncate text-xs text-fg-muted" dir="auto">
                        {hit.snippet}
                      </span>
                    )}
                  </span>
                  {active === i && <CornerDownLeft size={13} className="relative mt-1 text-fg-subtle flip-rtl" aria-hidden />}
                </div>
              )
            })}
          </div>
        ))}
        {docHits.length > 0 && (
          <div role="group" aria-label={t.search.groupDocuments} className="mb-1">
            <p className="px-2.5 pt-1.5 pb-1 text-2xs font-semibold tracking-wide text-fg-subtle uppercase" aria-hidden>
              {t.search.groupDocuments}
            </p>
            {docHits.map((hit) => {
              index += 1
              const i = index
              return (
                <div
                  key={`doc-${hit.id}-${hit.type === 'page' ? hit.page : 0}`}
                  id={optionId(i)}
                  role="option"
                  aria-selected={active === i}
                  onPointerMove={() => setActive(i)}
                  onClick={() => choose({ kind: 'doc', hit })}
                  className="relative flex cursor-default items-start gap-2.5 rounded-md px-2.5 py-2"
                >
                  {active === i && <Highlight />}
                  <span className="relative mt-0.5">
                    <FormatIcon format={hit.format} />
                  </span>
                  <span className="relative min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate text-base text-fg" dir="auto">
                        {hit.title}
                      </span>
                      {hit.type === 'page' && hit.format === 'pdf' && (
                        <span className="shrink-0 text-xs text-fg-subtle">{t.search.page(fmt.number(hit.page))}</span>
                      )}
                    </span>
                    <SnippetText snippet={hit.snippet} className="block truncate text-xs text-fg-muted" />
                  </span>
                  {active === i && <CornerDownLeft size={13} className="relative mt-1 text-fg-subtle flip-rtl" aria-hidden />}
                </div>
              )
            })}
          </div>
        )}
        {related.length > 0 && (
          <div role="group" aria-label={t.search.groupRelated} className="mb-1">
            <p className="flex items-center gap-1 px-2.5 pt-1.5 pb-1 text-2xs font-semibold tracking-wide text-fg-subtle uppercase" aria-hidden>
              <Sparkles size={10} />
              {t.search.groupRelated}
            </p>
            {related.map((hit) => {
              index += 1
              const i = index
              const s = hit.source
              return (
                <div
                  key={`sem-${hit.key}`}
                  id={optionId(i)}
                  role="option"
                  aria-selected={active === i}
                  onPointerMove={() => setActive(i)}
                  onClick={() => choose({ kind: 'sem', hit })}
                  className="relative flex cursor-default items-start gap-2.5 rounded-md px-2.5 py-2"
                >
                  {active === i && <Highlight />}
                  <span className="relative mt-0.5">{s.type === 'item' ? <KindIcon kind={s.itemKind} /> : <FormatIcon format={s.format} />}</span>
                  <span className="relative min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate text-base text-fg" dir="auto">
                        {s.title}
                      </span>
                      {s.type === 'document' && s.page !== null && <span className="shrink-0 text-xs text-fg-subtle">{t.search.page(fmt.number(s.page))}</span>}
                    </span>
                    <SnippetText snippet={hit.excerpt} className="block truncate text-xs text-fg-muted" />
                  </span>
                  {active === i && <CornerDownLeft size={13} className="relative mt-1 text-fg-subtle flip-rtl" aria-hidden />}
                </div>
              )
            })}
          </div>
        )}
        {showPanel && (
          <div
            id={optionId(options.length - 1)}
            role="option"
            aria-selected={active === options.length - 1}
            onPointerMove={() => setActive(options.length - 1)}
            onClick={() => choose({ kind: 'all' })}
            className={cn(
              'relative flex cursor-default items-center gap-2.5 rounded-md border-t border-line-subtle px-2.5 py-2 text-sm text-fg-muted',
              active === options.length - 1 && 'text-fg'
            )}
          >
            {active === options.length - 1 && <Highlight />}
            <Search size={14} aria-hidden className="relative" />
            <span className="relative flex-1 truncate">{t.search.seeAll(query.trim())}</span>
            <span className="relative text-xs text-fg-subtle">{t.search.resultsCount(fmt.number(results.total))}</span>
          </div>
        )}
      </motion.div>
      )}
      </AnimatePresence>
    </div>
  )
}
