import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link } from 'react-router'
import { ArrowUp, CircleAlert, Cloud, Cpu, Info, Loader2, MessageCirclePlus, MessagesSquare, Square, Trash2, UserRound } from 'lucide-react'
import { isCloudProvider, QUESTION_MAX, type AiSettingsView, type ConversationDetail, type ConversationSummary } from '@shared/ai'
import { Badge, Button, IconButton, Notice, Tooltip } from '@/design-system/components'
import { ConfirmDialog } from '@/features/shared/ConfirmDialog'
import { cn } from '@/lib/cn'
import { useAi, useAiSettings, type AskFailure } from '@/state/ai'
import { useI18n } from '@/state/preferences'
import { AnswerText, AssistantMessage, SourceList } from './AnswerView'

/** Everything needed before a question may be sent. Mirrors the checks main enforces. */
export function providerReady(s: AiSettingsView | null): boolean {
  if (!s || !s.provider) return false
  const p = s.provider
  if (!s[p].model.trim()) return false
  if (p === 'ollama') return true
  return s.credentials[p].state === 'configured' && s.cloudAcknowledged[p]
}

const SETTINGS_CODES = new Set(['not_configured', 'consent_required', 'auth', 'model_not_found', 'unavailable'])

function UserBubble({ text }: { text: string }) {
  const { t } = useI18n()
  return (
    <div className="flex justify-end gap-3">
      <div className="max-w-[80%] rounded-xl rounded-se-sm border border-line-subtle bg-raised px-4 py-2.5 text-md whitespace-pre-wrap text-fg" dir="auto">
        <span className="sr-only">{t.ai.ask.you}: </span>
        {text}
      </div>
      <div className="mt-0.5 flex size-6.5 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-fg-subtle">
        <UserRound size={14} aria-hidden />
      </div>
    </div>
  )
}

export default function AskPage() {
  const { t } = useI18n()
  const { api, live, version, started, ask, cancel } = useAi()
  const { settings } = useAiSettings()
  const [list, setList] = useState<ConversationSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ConversationDetail | null>(null)
  const [draft, setDraft] = useState('')
  const [failure, setFailure] = useState<AskFailure | null>(null)
  const [toDelete, setToDelete] = useState<ConversationSummary | null>(null)
  const [deleting, setDeleting] = useState(false)
  const startedFromNew = useRef(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const ready = providerReady(settings)
  const generating = live !== null

  // Conversation list: reload whenever a turn starts or ends.
  useEffect(() => {
    if (!api) return
    let alive = true
    void api.listConversations().then((r) => alive && r.ok && setList(r.value))
    return () => {
      alive = false
    }
  }, [api, version])

  // Open conversation: a late reply for a previously selected one is dropped.
  useEffect(() => {
    if (!api || !activeId) {
      setDetail(null)
      return
    }
    let alive = true
    void api.getConversation(activeId).then((r) => {
      if (!alive) return
      if (r.ok) setDetail(r.value)
      else {
        setDetail(null)
        setActiveId(null)
      }
    })
    return () => {
      alive = false
    }
  }, [api, activeId, version])

  // A question asked from an empty page moves the view into the conversation that was just created.
  useEffect(() => {
    if (startedFromNew.current && started) {
      startedFromNew.current = false
      setActiveId(started.conversationId)
    }
  }, [started])

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }, [draft])

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [detail?.messages.length, live?.text.length, live?.phase])

  const liveHere = live !== null && (live.conversationId === activeId || (live.conversationId === null && activeId === null))

  const send = async (question: string) => {
    const q = question.trim().slice(0, QUESTION_MAX)
    if (!q || !api || generating || !ready) return
    setFailure(null)
    setDraft('')
    startedFromNew.current = activeId === null
    const f = await ask(activeId, q)
    if (f) {
      startedFromNew.current = false
      setDraft(q)
      setFailure(f)
    }
  }
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void send(draft)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send(draft)
    }
  }
  const startNew = () => {
    startedFromNew.current = false
    setActiveId(null)
    setFailure(null)
    setDraft('')
    inputRef.current?.focus()
  }
  const confirmDelete = async () => {
    if (!api || !toDelete) return
    setDeleting(true)
    const r = await api.deleteConversation(toDelete.id)
    setDeleting(false)
    if (r.ok) {
      if (activeId === toDelete.id) setActiveId(null)
      setList((l) => l.filter((c) => c.id !== toDelete.id))
    }
    setToDelete(null)
  }

  const examples = [t.ask.example1, t.ask.example2, t.ask.example3, t.ask.example4]
  const messages = detail?.messages ?? []
  const lastIsUser = messages.at(-1)?.role === 'user'
  const showTempUser = liveHere && live !== null && !lastIsUser
  const errorText = failure ? (failure.code === 'unknown' ? t.ai.errors.internal : t.ai.errors[failure.code]) : null

  return (
    <div className="flex h-full min-h-0">
      <aside aria-label={t.ai.ask.conversations} className="hidden w-64 shrink-0 flex-col border-e border-line-subtle bg-sidebar/40 md:flex">
        <div className="p-3">
          <Button icon={MessageCirclePlus} onClick={startNew} className="w-full">
            {t.ai.ask.newConversation}
          </Button>
        </div>
        <p className="px-4 pt-2 pb-1.5 text-2xs font-semibold tracking-wider text-fg-subtle uppercase">{t.ai.ask.conversations}</p>
        <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {list.length === 0 && <li className="px-2 py-1 text-sm text-fg-muted">{t.ai.ask.conversationsEmpty}</li>}
          {list.map((c) => (
            <li key={c.id} className="group relative">
              <button
                type="button"
                onClick={() => {
                  startedFromNew.current = false
                  setActiveId(c.id)
                  setFailure(null)
                }}
                aria-current={c.id === activeId ? 'true' : undefined}
                className={cn('flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-2 pe-9 text-start transition-colors', c.id === activeId ? 'bg-active' : 'hover:bg-hover')}
              >
                <span className="w-full truncate text-sm text-fg" dir="auto">
                  {c.title}
                </span>
              </button>
              <IconButton
                icon={Trash2}
                label={`${t.ai.ask.deleteConversation}: ${c.title}`}
                size="sm"
                disabled={live?.conversationId === c.id}
                onClick={() => setToDelete(c)}
                className="absolute end-1 top-1.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
              />
            </li>
          ))}
        </ul>
      </aside>

      <section aria-label={t.nav.ask} className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-8 py-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-fg">{t.nav.ask}</h1>
                <p className="mt-1 text-base text-fg-muted">{t.ai.ask.description}</p>
              </div>
              <IconButton icon={MessageCirclePlus} label={t.ai.ask.newConversation} onClick={startNew} variant="secondary" className="md:hidden" />
            </div>

            {settings?.provider && (
              <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted" role="status" aria-label={t.ai.ask.providerLabel}>
                <Badge tone={isCloudProvider(settings.provider) ? 'warning' : 'success'} icon={isCloudProvider(settings.provider) ? Cloud : Cpu}>
                  {isCloudProvider(settings.provider) ? t.ai.kindCloud : t.ai.kindLocal}
                </Badge>
                <span>{t.ai.providers[settings.provider]}</span>
                <span dir="ltr" className="text-fg">
                  {settings[settings.provider].model || '—'}
                </span>
                <Link to="/settings#ai" className="text-accent-text underline-offset-2 hover:underline">
                  {t.ai.ask.openSettings}
                </Link>
              </div>
            )}
            {!ready && (
              <Notice icon={Info} tone="info">
                <p className="font-medium text-fg">{t.ai.ask.notConfiguredTitle}</p>
                <p className="mt-0.5">{t.ai.ask.notConfiguredHint}</p>
                <Link to="/settings#ai" className="mt-1 inline-block font-medium text-accent-text underline-offset-2 hover:underline">
                  {t.ai.ask.openSettings}
                </Link>
              </Notice>
            )}
            {ready && settings?.provider && (
              <Notice icon={Info} tone={isCloudProvider(settings.provider) ? 'accent' : 'neutral'}>
                {isCloudProvider(settings.provider) ? t.ai.ask.bannerCloud(t.ai.providers[settings.provider]) : t.ai.ask.bannerLocal}
              </Notice>
            )}

            {!detail && !live ? (
              <div className="flex flex-col items-center gap-5 py-6 text-center">
                <div className="flex size-12 items-center justify-center rounded-xl border border-line-subtle bg-raised text-fg-subtle">
                  <MessagesSquare size={21} strokeWidth={1.5} aria-hidden />
                </div>
                <div>
                  <p className="text-md font-medium text-fg">{t.ai.ask.emptyTitle}</p>
                  <p className="mt-1 text-sm text-fg-muted">{t.ai.ask.emptyHint}</p>
                </div>
                <div className="w-full">
                  <p className="mb-2 text-xs font-semibold tracking-wide text-fg-subtle uppercase">{t.ask.examplesTitle}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {examples.map((ex) => (
                      <button
                        key={ex}
                        type="button"
                        dir="auto"
                        onClick={() => void send(ex)}
                        disabled={!ready || generating}
                        className="rounded-lg border border-line-subtle bg-surface px-3.5 py-3 text-start text-sm text-fg-muted transition-colors hover:border-line hover:bg-raised hover:text-fg disabled:opacity-60"
                      >
                        {ex}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-5" aria-live="polite" aria-busy={generating}>
                {messages.map((m, i) =>
                  m.role === 'user' ? (
                    <UserBubble key={m.id} text={m.content} />
                  ) : (
                    <AssistantMessage key={m.id} message={m} question={messages[i - 1]?.role === 'user' ? messages[i - 1]!.content : ''} />
                  )
                )}
                {showTempUser && <UserBubble text={live.question} />}
                {liveHere && live && (
                  <div className="flex flex-col gap-3" data-testid="live-answer">
                    <div role="status" className="flex items-center gap-2.5 text-sm text-fg-subtle">
                      <Loader2 size={15} className="animate-spin" aria-hidden />
                      {live.phase === 'retrieving' ? t.ai.ask.phaseRetrieving : t.ai.ask.phaseGenerating}
                      {live.sources.length > 0 && <span>· {t.ai.ask.usingSources(String(live.sources.length))}</span>}
                    </div>
                    {live.semanticAvailable === false && <Notice icon={Info}>{t.ai.ask.semanticOff}</Notice>}
                    {live.text && (
                      // While streaming, markers are plain text; they become links only after the final check.
                      <AnswerText content={live.text} sources={[]} streaming />
                    )}
                    {live.sources.length > 0 && !live.text && <SourceList sources={live.sources.map((s) => ({ ...s }))} />}
                  </div>
                )}
              </div>
            )}
            <div ref={endRef} />
          </div>
        </div>

        <div className="shrink-0 border-t border-line-subtle bg-canvas">
          <form onSubmit={onSubmit} className="mx-auto w-full max-w-3xl px-8 py-4">
            {failure && errorText && (
              <div className="mb-3">
                <Notice icon={CircleAlert}>
                  {errorText}{' '}
                  {SETTINGS_CODES.has(failure.code) && (
                    <Link to="/settings#ai" className="font-medium text-accent-text underline-offset-2 hover:underline">
                      {t.ai.ask.openSettings}
                    </Link>
                  )}
                </Notice>
              </div>
            )}
            <div className="flex items-end gap-2 rounded-xl border border-line bg-surface p-2 ps-3.5 transition-colors focus-within:border-accent-line focus-within:ring-3 focus-within:ring-accent-soft">
              <label htmlFor="ask-input" className="sr-only">
                {t.ai.ask.inputLabel}
              </label>
              <textarea
                id="ask-input"
                ref={inputRef}
                dir="auto"
                rows={1}
                maxLength={QUESTION_MAX}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                disabled={!ready}
                placeholder={t.ai.ask.inputPlaceholder}
                className="max-h-44 min-h-8 flex-1 resize-none bg-transparent py-1.5 text-md text-fg placeholder:text-fg-subtle focus-visible:outline-none disabled:opacity-60"
              />
              {generating ? (
                <Tooltip content={t.ai.ask.stop}>
                  <button
                    type="button"
                    aria-label={t.ai.ask.stop}
                    onClick={cancel}
                    disabled={!live?.generationId}
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-raised text-fg transition-colors hover:bg-hover disabled:text-fg-disabled"
                  >
                    <Square size={14} strokeWidth={2} aria-hidden />
                  </button>
                </Tooltip>
              ) : (
                <Tooltip content={t.ai.ask.send}>
                  <button
                    type="submit"
                    aria-label={t.ai.ask.send}
                    disabled={!draft.trim() || !api || !ready}
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-fg transition-colors hover:bg-accent-hover disabled:bg-raised disabled:text-fg-disabled"
                  >
                    <ArrowUp size={16} strokeWidth={2} aria-hidden />
                  </button>
                </Tooltip>
              )}
            </div>
            <p className="mt-2 text-xs text-fg-subtle">{t.ai.ask.sendHint}</p>
          </form>
        </div>
      </section>

      <ConfirmDialog
        open={toDelete !== null}
        title={t.ai.ask.deleteTitle}
        description={t.ai.ask.deleteDescription}
        confirmLabel={t.ai.ask.deleteConfirm}
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setToDelete(null)}
      />
    </div>
  )
}
