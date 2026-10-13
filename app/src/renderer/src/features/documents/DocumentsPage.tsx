import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { FileSearch, FileUp, FolderOpen, MoreHorizontal, RotateCcw, SearchX, Trash2 } from 'lucide-react'
import { DOCUMENT_FORMATS, DOCUMENT_STATUSES, type DocumentFormat, type DocumentStatus, type DocumentSummary, type SearchResult } from '@shared/documents'
import { Button, EmptyState, ErrorState, IconButton, Input, Menu, MenuItem, Panel, Select, Skeleton, useToast } from '@/design-system/components'
import { ConfirmDialog } from '@/features/shared/ConfirmDialog'
import { Page, PageHeader } from '@/features/shared/PageHeader'
import { useI18n } from '@/state/preferences'
import { unwrapResult } from '@/state/documents'
import { normalizeText } from '@/lib/text'
import { FormatIcon, StatusBadge, formatBytes } from './meta'
import { SnippetText } from './SnippetText'
import { useDocumentList } from './useDocuments'
import { documentPath } from '@/app/navigation'

type Sort = 'newest' | 'title' | 'size'
type Hit = Extract<SearchResult, { type: 'page' | 'document' }>

/** Imported documents: import, filter, sort, open, retry, remove. Filters live in the URL. */
export default function DocumentsPage() {
  const { t, fmt } = useI18n()
  const toast = useToast()
  const navigate = useNavigate()
  const { api, state, refresh } = useDocumentList()
  const [params, setParams] = useSearchParams()
  const [importing, setImporting] = useState(false)
  const [removing, setRemoving] = useState<DocumentSummary | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)
  const [hits, setHits] = useState<Hit[] | null>(null)

  const text = params.get('q') ?? ''
  const format = (params.get('format') as DocumentFormat | null) ?? 'all'
  const status = (params.get('status') as DocumentStatus | null) ?? 'all'
  const sort = (params.get('sort') as Sort | null) ?? 'newest'
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  // Content search goes to the FTS index in main; debounced, stale answers ignored.
  useEffect(() => {
    if (!api || text.trim().length < 2) {
      setHits(null)
      return
    }
    let stale = false
    const timer = setTimeout(() => {
      unwrapResult(api.search({ text, scopes: ['document'], limit: 20 })).then(
        (r) => !stale && setHits(r.results.filter((x): x is Hit => x.type !== 'item')),
        () => !stale && setHits([])
      )
    }, 200)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [api, text, state])

  const docs = useMemo(() => {
    if (state.status !== 'ready') return []
    const q = normalizeText(text)
    const list = state.docs.filter(
      (d) =>
        (format === 'all' || d.format === format) &&
        (status === 'all' || d.status === status) &&
        (!q || normalizeText(`${d.title} ${d.fileName}`).includes(q))
    )
    const sorted = [...list]
    if (sort === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title))
    else if (sort === 'size') sorted.sort((a, b) => b.sizeBytes - a.sizeBytes)
    return sorted
  }, [state, text, format, status, sort])

  if (!api) {
    return (
      <Page>
        <PageHeader title={t.documents.title} />
        <EmptyState icon={FolderOpen} title={t.documents.unavailable} />
      </Page>
    )
  }

  const runImport = async () => {
    setImporting(true)
    try {
      const r = await unwrapResult(api.importDocuments())
      if (r.cancelled) return
      const count = (o: string) => r.results.filter((x) => x.outcome === o).length
      const rejected = r.results.filter((x) => x.outcome === 'rejected')
      toast({
        title: t.documents.importSummary(count('imported'), count('duplicate'), rejected.length),
        ...(rejected.length
          ? { description: rejected.map((x) => t.documents.rejectedDetail(x.fileName, t.documents.rejections[x.reason])).join('\n') }
          : {}),
        tone: rejected.length && !count('imported') ? 'error' : 'success'
      })
      const single = r.results.length === 1 ? r.results[0] : undefined
      if (single && single.outcome === 'duplicate') navigate(documentPath(single.document.id))
    } catch {
      toast({ title: t.common.saveFailed, description: t.common.saveFailedHint, tone: 'error' })
    } finally {
      setImporting(false)
      void refresh()
    }
  }

  const reprocess = async (d: DocumentSummary) => {
    const p = unwrapResult(api.reprocess(d.id)).catch(() => undefined)
    setTimeout(() => void refresh(), 50)
    await p
    void refresh()
  }

  const confirmRemove = async () => {
    if (!removing) return
    setRemoveBusy(true)
    try {
      const r = await unwrapResult(api.remove(removing.id))
      toast({ title: r.fileDeleted ? t.documents.removed : t.documents.removeFileWarning, tone: 'success' })
      setRemoving(null)
    } catch {
      toast({ title: t.common.saveFailed, description: t.common.saveFailedHint, tone: 'error' })
    } finally {
      setRemoveBusy(false)
      void refresh()
    }
  }

  return (
    <Page>
      <PageHeader
        title={t.documents.title}
        description={t.documents.description}
        actions={
          <Button variant="primary" icon={FileUp} loading={importing} onClick={() => void runImport()}>
            {importing ? t.documents.importing : t.documents.import}
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          type="search"
          aria-label={t.documents.filterPlaceholder}
          placeholder={t.documents.filterPlaceholder}
          dir="auto"
          value={text}
          onChange={(e) => set('q', e.target.value)}
          className="max-w-72"
        />
        <Select<DocumentFormat | 'all'>
          aria-label={t.documents.format}
          size="sm"
          className="w-36"
          value={format}
          onChange={(v) => set('format', v === 'all' ? '' : v)}
          options={[{ value: 'all', label: t.documents.anyFormat }, ...DOCUMENT_FORMATS.map((f) => ({ value: f, label: f.toUpperCase() }))]}
        />
        <Select<DocumentStatus | 'all'>
          aria-label={t.common.status}
          size="sm"
          className="w-44"
          value={status}
          onChange={(v) => set('status', v === 'all' ? '' : v)}
          options={[{ value: 'all', label: t.documents.anyStatus }, ...DOCUMENT_STATUSES.map((s) => ({ value: s, label: t.documents.status[s] }))]}
        />
        <Select<Sort>
          aria-label={t.documents.sortLabel}
          size="sm"
          className="w-40"
          value={sort}
          onChange={(v) => set('sort', v === 'newest' ? '' : v)}
          options={[
            { value: 'newest', label: t.documents.sortNewest },
            { value: 'title', label: t.documents.sortTitle },
            { value: 'size', label: t.documents.sortSize }
          ]}
        />
      </div>

      {state.status === 'loading' && (
        <div className="flex flex-col gap-2" aria-busy>
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      )}
      {state.status === 'error' && <ErrorState title={t.documents.loadFailed} action={<Button onClick={() => void refresh()}>{t.documents.retry}</Button>} />}
      {state.status === 'ready' && state.docs.length === 0 && (
        <EmptyState
          icon={FolderOpen}
          title={t.documents.emptyTitle}
          description={t.documents.emptyDescription}
          action={
            <Button variant="primary" icon={FileUp} onClick={() => void runImport()} loading={importing}>
              {t.documents.import}
            </Button>
          }
        />
      )}
      {state.status === 'ready' && state.docs.length > 0 && (
        <div className="flex flex-col gap-4">
          {docs.length === 0 ? (
            <EmptyState compact icon={SearchX} title={t.documents.noResults} />
          ) : (
            <Panel bodyClassName="divide-y divide-line-subtle">
              <ul aria-label={t.documents.title}>
                {docs.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                    <FormatIcon format={d.format} size={18} />
                    <div className="min-w-0 flex-1">
                      <Link to={documentPath(d.id)} className="block truncate text-base font-medium text-fg hover:text-accent-text" dir="auto">
                        {d.title}
                      </Link>
                      <p className="truncate text-xs text-fg-subtle">
                        <span dir="auto">{d.fileName}</span>
                        {' · '}
                        {d.format.toUpperCase()} · {formatBytes(d.sizeBytes, fmt.number)}
                        {d.pageCount !== null && ` · ${t.documents.pages(fmt.number(d.pageCount))}`}
                        {' · '}
                        {fmt.date(d.importedAt, 'medium')}
                      </p>
                      {d.error && <p className="mt-0.5 text-xs text-danger">{t.documents.errors[d.error]}</p>}
                    </div>
                    <StatusBadge status={d.status} />
                    {d.status === 'failed' && (
                      <Button size="sm" icon={RotateCcw} onClick={() => void reprocess(d)}>
                        {t.documents.retry}
                      </Button>
                    )}
                    <Menu trigger={<IconButton icon={MoreHorizontal} label={`${t.documents.open}: ${d.title}`} size="sm" />}>
                      <MenuItem onSelect={() => navigate(documentPath(d.id))}>{t.documents.open}</MenuItem>
                      <MenuItem disabled={d.status === 'processing'} onSelect={() => void reprocess(d)}>
                        {t.documents.reprocess}
                      </MenuItem>
                      <MenuItem icon={Trash2} onSelect={() => setRemoving(d)}>
                        {t.documents.remove}
                      </MenuItem>
                    </Menu>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {hits !== null && (
            <Panel title={t.documents.contentMatches} icon={FileSearch} bodyClassName="divide-y divide-line-subtle">
              {hits.length === 0 ? (
                <p className="px-4 py-4 text-sm text-fg-muted">{t.documents.noContentMatches}</p>
              ) : (
                <ul>
                  {hits.map((h) => (
                    <li key={`${h.id}-${h.type === 'page' ? h.page : 'doc'}`}>
                      <Link to={documentPath(h.id, h.type === 'page' ? h.page : undefined, text)} className="block px-4 py-2.5 hover:bg-hover">
                        <span className="flex items-center gap-2 text-sm text-fg">
                          <FormatIcon format={h.format} />
                          <span className="truncate" dir="auto">
                            {h.title}
                          </span>
                          {h.type === 'page' && h.format === 'pdf' && <span className="text-xs text-fg-subtle">{t.search.page(fmt.number(h.page))}</span>}
                        </span>
                        <SnippetText snippet={h.snippet} className="mt-0.5 block text-xs text-fg-muted" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </div>
      )}

      <ConfirmDialog
        open={removing !== null}
        title={t.documents.removeTitle}
        description={t.documents.removeDescription}
        confirmLabel={t.documents.remove}
        busy={removeBusy}
        onConfirm={() => void confirmRemove()}
        onCancel={() => setRemoving(null)}
      />
    </Page>
  )
}
