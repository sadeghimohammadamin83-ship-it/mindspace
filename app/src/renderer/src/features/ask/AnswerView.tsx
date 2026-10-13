import { Fragment, useMemo } from 'react'
import { useNavigate } from 'react-router'
import { BookOpenText, CircleAlert, Info, Scissors, SearchX, ShieldAlert, Square } from 'lucide-react'
import type { AnswerSource, ChatMessage } from '@shared/ai'
import { segmentAnswer } from '@shared/citations'
import { Badge, Button, Notice } from '@/design-system/components'
import { documentPath, refPath } from '@/app/navigation'
import { FormatIcon } from '@/features/documents/meta'
import { KindIcon } from '@/features/shared/meta'
import { cn } from '@/lib/cn'
import { useI18n } from '@/state/preferences'
import type { ItemKind } from '@shared/domain'

/** Where a TRUSTED source opens. Built only from the main-process source map, never from model text. */
export function sourcePath(s: AnswerSource, question?: string): string {
  return s.entity === 'item' ? refPath({ type: 'item', id: s.id }) : documentPath(s.id, s.page ?? undefined, question)
}

function CitationChip({ source, question }: { source: AnswerSource; question?: string }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const label = t.ai.ask.citationLabel(source.ref, source.title)
  const base = 'num mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded border px-1 align-baseline text-2xs font-medium'
  if (source.available === false) {
    return (
      <span className={cn(base, 'border-line text-fg-disabled line-through')} title={`${label} · ${t.ai.ask.unavailable}`} aria-label={`${label}. ${t.ai.ask.unavailable}`}>
        {source.ref}
      </span>
    )
  }
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={() => navigate(sourcePath(source, question))}
      className={cn(base, 'border-accent-line bg-accent-soft text-accent-text transition-colors hover:bg-accent/20')}
    >
      {source.ref}
    </button>
  )
}

/** The answer text with citation chips for VALID markers only; unknown ids are shown struck through and are not links. */
export function AnswerText({ content, sources, question, streaming }: { content: string; sources: AnswerSource[]; question?: string; streaming?: boolean }) {
  const { t } = useI18n()
  const byRef = useMemo(() => new Map(sources.map((s) => [s.ref, s])), [sources])
  const segments = useMemo(() => segmentAnswer(content, new Set(byRef.keys())), [content, byRef])
  // While text is still arriving nothing is validated yet, so nothing is rendered as a link or as an "unknown source".
  if (streaming) {
    return (
      <div className="text-md leading-relaxed whitespace-pre-wrap text-fg" dir="auto">
        {content}
      </div>
    )
  }
  return (
    <div className="text-md leading-relaxed whitespace-pre-wrap text-fg" dir="auto">
      {segments.map((seg, i) => {
        if (seg.type === 'text') return <Fragment key={i}>{seg.text}</Fragment>
        if (seg.type === 'cite') return seg.refs.map((r) => <CitationChip key={`${i}-${r}`} source={byRef.get(r)!} {...(question ? { question } : {})} />)
        return (
          <span key={i} className="mx-0.5 text-fg-disabled line-through" title={t.ai.ask.invalidCitationTip}>
            {seg.raw}
          </span>
        )
      })}
    </div>
  )
}

export function SourceList({ sources, question }: { sources: AnswerSource[]; question?: string }) {
  const { t, fmt } = useI18n()
  const navigate = useNavigate()
  if (!sources.length) return null
  return (
    <section aria-label={t.ai.ask.sources}>
      <p className="text-xs font-semibold tracking-wide text-fg-subtle uppercase">{t.ai.ask.sources}</p>
      <p className="mt-0.5 mb-2.5 text-xs text-fg-subtle">{t.ai.ask.sourcesHint}</p>
      <ol className="flex flex-col gap-2">
        {sources.map((s) => {
          const gone = s.available === false
          return (
            <li key={s.ref} className={cn('rounded-lg border bg-surface', gone ? 'border-dashed border-line-subtle' : 'border-line-subtle')}>
              <div className="flex items-start gap-3 px-4 pt-3">
                <span className="num mt-0.5 flex h-5 min-w-5 shrink-0 items-center justify-center rounded border border-line px-1 text-2xs text-fg-muted">{s.ref}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {s.entity === 'item' ? <KindIcon kind={(s.itemKind ?? 'note') as ItemKind} size={14} /> : <FormatIcon format={s.kind === 'pdf_page' ? 'pdf' : 'txt'} />}
                    <span className={cn('truncate text-base font-medium', gone ? 'text-fg-muted' : 'text-fg')} dir="auto">
                      {s.title}
                    </span>
                    <Badge tone="neutral">{t.ai.ask.sourceKinds[s.kind]}</Badge>
                    {s.page !== null && <span className="text-xs text-fg-subtle">{t.ai.ask.page(fmt.number(s.page))}</span>}
                    {gone && <Badge tone="warning">{t.ai.ask.unavailable}</Badge>}
                  </div>
                  {/* The passage that was sent, shown as text, never as HTML. */}
                  <blockquote className="mt-2 border-s-2 border-line ps-3 text-sm leading-relaxed text-fg-muted" dir="auto">
                    {s.excerpt}
                  </blockquote>
                  {gone && <p className="mt-1.5 text-xs text-fg-subtle">{t.ai.ask.unavailableHint}</p>}
                </div>
              </div>
              {!gone && (
                <div className="flex justify-end px-3 pt-1 pb-2.5">
                  <Button size="sm" variant="ghost" icon={BookOpenText} onClick={() => navigate(sourcePath(s, question))}>
                    {s.page !== null ? t.ai.ask.openPage(fmt.number(s.page)) : t.ai.ask.openSource}
                  </Button>
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/** A finished (or ended) assistant turn from the database. */
export function AssistantMessage({ message, question }: { message: ChatMessage; question?: string }) {
  const { t, fmt } = useI18n()
  const sources = message.sources ?? []
  const check = message.check
  const err = message.errorCode ? (t.ai.errors[message.errorCode] ?? t.ai.errors.internal) : t.ai.ask.failed

  if (message.noEvidence) {
    return (
      <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-line-subtle px-4 py-6 text-center">
        <SearchX size={18} strokeWidth={1.5} className="text-fg-subtle" aria-hidden />
        <p className="text-sm text-fg">{t.ai.ask.noEvidenceTitle}</p>
        <p className="text-xs text-fg-subtle">{t.ai.ask.noEvidenceHint}</p>
        {message.semanticAvailable === false && <p className="text-xs text-fg-subtle">{t.ai.ask.semanticOff}</p>}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      {message.status === 'error' && (
        <Notice icon={CircleAlert}>
          <p>{err}</p>
          {message.content && <p className="mt-1 text-xs text-fg-subtle">{t.ai.ask.partialKept}</p>}
        </Notice>
      )}
      {message.content && <AnswerText content={message.content} sources={sources} {...(question ? { question } : {})} />}
      {message.status === 'cancelled' && (
        <Notice icon={Square}>{t.ai.ask.cancelled}</Notice>
      )}
      {message.status === 'complete' && message.finish === 'length' && <Notice icon={Scissors}>{t.ai.ask.truncated}</Notice>}
      {message.status === 'complete' && message.finish === 'refusal' && <Notice icon={ShieldAlert}>{t.ai.ask.refused}</Notice>}
      {message.status === 'complete' && message.semanticAvailable === false && <Notice icon={Info}>{t.ai.ask.semanticOff}</Notice>}
      {message.status === 'complete' && check && (
        <div className="flex flex-col gap-1.5">
          {check.validCitations === 0 && message.finish !== 'refusal' ? (
            <Notice icon={ShieldAlert}>{t.ai.ask.noCitations}</Notice>
          ) : (
            <p className="text-xs text-fg-subtle">
              {t.ai.ask.citationsChecked(fmt.number(check.validCitations))}
              {check.uncitedSentences > 0 && <span className="text-warning"> · {t.ai.ask.uncited(fmt.number(check.uncitedSentences))}</span>}
            </p>
          )}
          {check.invalidCitations.length > 0 && <Notice icon={ShieldAlert}>{t.ai.ask.invalidCitations(check.invalidCitations.map((x) => `[${x}]`).join(' '))}</Notice>}
        </div>
      )}
      <SourceList sources={sources} {...(question ? { question } : {})} />
      {(message.model || message.durationMs != null) && (
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-fg-subtle">
          {message.provider && <span>{t.ai.providers[message.provider]}</span>}
          {message.model && <span dir="ltr">· {message.model}</span>}
          {message.durationMs != null && <span>· {t.ai.ask.seconds(fmt.number(Math.max(0.1, Math.round(message.durationMs / 100) / 10)))}</span>}
          {message.usage && message.usage.inputTokens !== null && message.usage.outputTokens !== null && (
            <span>· {t.ai.ask.tokens(fmt.number(message.usage.inputTokens), fmt.number(message.usage.outputTokens))}</span>
          )}
        </p>
      )}
    </div>
  )
}
