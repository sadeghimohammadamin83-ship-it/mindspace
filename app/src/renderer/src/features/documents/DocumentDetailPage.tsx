import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight, Info, RotateCcw, ScanText, Trash2 } from 'lucide-react'
import type { DocumentPage, DocumentSummary } from '@shared/documents'
import { Button, EmptyState, ErrorState, IconButton, Input, Notice, Panel, Skeleton, useToast } from '@/design-system/components'
import { ConfirmDialog } from '@/features/shared/ConfirmDialog'
import { Page, PageHeader } from '@/features/shared/PageHeader'
import { useI18n } from '@/state/preferences'
import { unwrapResult, useDocumentsApi } from '@/state/documents'
import { FormatIcon, StatusBadge, formatBytes } from './meta'
import { SnippetText, highlightRanges } from './SnippetText'

type DocState = { status: 'loading' } | { status: 'missing' } | { status: 'error' } | { status: 'ready'; doc: DocumentSummary }
type PageState = { status: 'loading' } | { status: 'none' } | { status: 'ready'; page: DocumentPage }

/**
 * Extracted-text reader. PDFs are read page by page (?page=N, one-based);
 * ?q highlights the search terms. Shows extracted text only; the original
 * file is never loaded into the renderer.
 */
export default function DocumentDetailPage() {
  const { t, fmt } = useI18n()
  const api = useDocumentsApi()
  const toast = useToast()
  const navigate = useNavigate()
  const { documentId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const [doc, setDoc] = useState<DocState>({ status: 'loading' })
  const [page, setPage] = useState<PageState>({ status: 'loading' })
  const [jump, setJump] = useState('')
  const [removing, setRemoving] = useState(false)
  const [busy, setBusy] = useState(false)

  const q = params.get('q') ?? ''
  const requested = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1)

  const load = useCallback(async () => {
    if (!api) return
    try {
      setDoc({ status: 'ready', doc: await unwrapResult(api.get(documentId)) })
    } catch (err) {
      const code = (err as { code?: string }).code
      setDoc({ status: code === 'not_found' || code === 'validation' ? 'missing' : 'error' })
    }
  }, [api, documentId])

  useEffect(() => void load(), [load])

  const summary = doc.status === 'ready' ? doc.doc : null
  const pageCount = summary ? (summary.format === 'pdf' ? (summary.pageCount ?? 0) : 1) : 0
  const current = Math.min(requested, Math.max(1, pageCount))
  const processing = summary?.status === 'processing' || summary?.status === 'imported'

  useEffect(() => {
    if (!processing) return
    const timer = setInterval(() => void load(), 800)
    return () => clearInterval(timer)
  }, [processing, load])

  const hasText = summary !== null && (summary.status === 'indexed' || summary.status === 'no_text' || (summary.charCount ?? 0) > 0)
  useEffect(() => {
    if (!api || !summary || !hasText) {
      setPage({ status: 'none' })
      return
    }
    let stale = false
    setPage({ status: 'loading' })
    unwrapResult(api.getPage({ id: summary.id, page: current })).then(
      (p) => !stale && setPage({ status: 'ready', page: p }),
      () => !stale && setPage({ status: 'none' })
    )
    return () => {
      stale = true
    }
  }, [api, summary?.id, summary?.updatedAt, current, hasText]) // eslint-disable-line react-hooks/exhaustive-deps

  const goTo = (n: number) => {
    const next = new URLSearchParams(params)
    next.set('page', String(Math.min(Math.max(1, n), pageCount)))
    setParams(next, { replace: true })
  }

  const snippet = useMemo(
    () => (page.status === 'ready' ? { text: page.page.text, marks: highlightRanges(page.page.text, q) } : null),
    [page, q]
  )

  if (!api) return <Page>{t.documents.unavailable}</Page>
  if (doc.status === 'loading') {
    return (
      <Page width="narrow">
        <Skeleton className="mb-4 h-8 w-64" />
        <Skeleton className="h-64" />
      </Page>
    )
  }
  if (doc.status === 'missing' || doc.status === 'error') {
    return (
      <Page width="narrow">
        <ErrorState
          title={doc.status === 'missing' ? t.documents.notFound : t.documents.loadFailed}
          action={
            <Link to="/documents" className="text-sm text-accent-text hover:underline">
              {t.documents.back}
            </Link>
          }
        />
      </Page>
    )
  }
  const d = doc.doc

  const reprocess = async () => {
    setBusy(true)
    const p = unwrapResult(api.reprocess(d.id)).catch(() => undefined)
    setTimeout(() => void load(), 50)
    await p
    setBusy(false)
    void load()
  }
  const remove = async () => {
    setBusy(true)
    try {
      const r = await unwrapResult(api.remove(d.id))
      toast({ title: r.fileDeleted ? t.documents.removed : t.documents.removeFileWarning, tone: 'success' })
      navigate('/documents')
    } catch {
      toast({ title: t.common.saveFailed, description: t.common.saveFailedHint, tone: 'error' })
      setBusy(false)
    }
  }

  return (
    <Page width="narrow">
      <Link to="/documents" className="mb-3 inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft size={14} className="flip-rtl" aria-hidden />
        {t.documents.back}
      </Link>
      <PageHeader
        title={d.title}
        eyebrow={
          <span className="flex items-center gap-2">
            <FormatIcon format={d.format} />
            <StatusBadge status={d.status} />
          </span>
        }
        actions={
          <>
            <Button size="sm" icon={RotateCcw} loading={busy && processing} disabled={processing} onClick={() => void reprocess()}>
              {d.status === 'failed' ? t.documents.retry : t.documents.reprocess}
            </Button>
            <Button size="sm" variant="danger" icon={Trash2} disabled={busy} onClick={() => setRemoving(true)}>
              {t.documents.remove}
            </Button>
          </>
        }
      />

      <dl className="mb-5 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-5">
        {[
          [t.documents.format, d.format.toUpperCase()],
          [t.documents.size, formatBytes(d.sizeBytes, fmt.number)],
          [t.documents.imported, fmt.date(d.importedAt, 'medium')],
          [t.documents.pageCount, d.pageCount === null ? '—' : fmt.number(d.pageCount)],
          [t.documents.characters, d.charCount === null ? '—' : fmt.number(d.charCount)]
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-fg-subtle">{k}</dt>
            <dd className="text-fg" dir="auto">
              {v}
            </dd>
          </div>
        ))}
        <div className="col-span-full">
          <dt className="sr-only">File</dt>
          <dd className="truncate text-xs text-fg-subtle" dir="auto">
            {d.fileName}
          </dd>
        </div>
      </dl>

      <div className="mb-4 flex flex-col gap-2">
        {d.error && (
          <div role="alert">
            <Notice icon={AlertTriangle} tone="accent">
              {t.documents.errors[d.error]}
            </Notice>
          </div>
        )}
        {d.status === 'no_text' && (
          <Notice icon={ScanText} tone="info">
            {t.documents.noTextExplanation}
          </Notice>
        )}
        {hasText && d.status !== 'no_text' && <Notice icon={Info}>{t.documents.extractedNote}</Notice>}
      </div>

      {hasText && (
        <Panel
          title={d.format === 'pdf' ? t.documents.pageOf(fmt.number(current), fmt.number(pageCount)) : d.fileName}
          action={
            d.format === 'pdf' && pageCount > 1 ? (
              <div className="flex items-center gap-1">
                <IconButton icon={ChevronLeft} flip label={t.documents.previousPage} size="sm" disabled={current <= 1} onClick={() => goTo(current - 1)} />
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    const n = Number.parseInt(jump, 10)
                    if (Number.isFinite(n)) goTo(n)
                    setJump('')
                  }}
                >
                  <Input
                    aria-label={t.documents.goToPage}
                    placeholder={t.documents.goToPage}
                    inputMode="numeric"
                    value={jump}
                    onChange={(e) => setJump(e.target.value.replace(/[^0-9۰-۹]/g, '').replace(/[۰-۹]/g, (c) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))))}
                    className="h-7 w-28 text-sm"
                  />
                </form>
                <IconButton icon={ChevronRight} flip label={t.documents.nextPage} size="sm" disabled={current >= pageCount} onClick={() => goTo(current + 1)} />
              </div>
            ) : undefined
          }
        >
          <div className="px-5 py-4" data-testid="document-text">
            {page.status === 'loading' && <Skeleton className="h-40" />}
            {page.status === 'ready' && snippet && (snippet.text.trim() ? (
              <SnippetText snippet={snippet} className="block text-base leading-7 whitespace-pre-wrap text-fg" />
            ) : (
              <EmptyState compact icon={ScanText} title={t.documents.emptyPage} />
            ))}
          </div>
        </Panel>
      )}

      <ConfirmDialog
        open={removing}
        title={t.documents.removeTitle}
        description={t.documents.removeDescription}
        confirmLabel={t.documents.remove}
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(false)}
      />
    </Page>
  )
}

