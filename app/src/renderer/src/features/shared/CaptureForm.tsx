import { useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { HardDrive } from 'lucide-react'
import { ITEM_KINDS, TASK_PRIORITIES, type Id, type ItemKind, type SourceRef } from '@shared/domain'
import { Button, Field, Input, Kbd, Segmented, Textarea, useToast } from '@/design-system/components'
import { refPath } from '@/app/navigation'
import { cn } from '@/lib/cn'
import { useI18n, usePreferences } from '@/state/preferences'
import { useWorkspace } from '@/state/workspace'
import { tagsByUsage } from '@/state/selectors'
import { DateField } from './DateField'
import { KIND_ICON } from './meta'
import { ProjectSelect } from './ProjectSelect'
import { TagInput } from './TagInput'
import { isHttpUrl, validateTitle } from './validation'
import { useSaveError } from './useSaveError'

export type CaptureKind = ItemKind | 'task'
const CAPTURE_KINDS: CaptureKind[] = [...ITEM_KINDS, 'task']

interface FormState {
  kind: CaptureKind
  title: string
  body: string
  url: string
  tags: string[]
  projectId: Id | null
  dueDate: string | null
  priority: (typeof TASK_PRIORITIES)[number]
}

interface Errors {
  title?: string
  url?: string
  body?: string
}

/**
 * The single capture form, used by the Quick Capture page and dialog.
 * Ctrl+Enter saves from any field; the parent decides what Cancel does.
 */
export function CaptureForm({
  onCancel,
  onSaved,
  initialKind,
  initialProjectId = null,
  autoFocus = true,
  layout = 'dialog'
}: {
  onCancel?: () => void
  onSaved?: (ref: SourceRef) => void
  initialKind?: CaptureKind
  initialProjectId?: Id | null
  autoFocus?: boolean
  layout?: 'dialog' | 'page'
}) {
  const { t } = useI18n()
  const { prefs } = usePreferences()
  const { data, commands } = useWorkspace()
  const toast = useToast()
  const navigate = useNavigate()
  const fresh = (kind: CaptureKind): FormState => ({
    kind,
    title: '',
    body: '',
    url: '',
    tags: [],
    projectId: initialProjectId,
    dueDate: null,
    priority: 'medium'
  })
  const [form, setForm] = useState<FormState>(() => fresh(initialKind ?? prefs.defaultCaptureKind))
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const saveError = useSaveError()
  const refs = {
    title: useRef<HTMLInputElement>(null),
    url: useRef<HTMLInputElement>(null),
    body: useRef<HTMLTextAreaElement>(null)
  }

  const validate = (f: FormState): Errors => {
    const errors: Errors = {}
    const titleErr = validateTitle(f.title)
    if (titleErr) errors.title = titleErr === 'empty' ? t.capture.errorTitle : t.capture.errorTitleLong
    if (f.kind === 'link' && !isHttpUrl(f.url)) errors.url = t.capture.errorUrl
    if (f.kind === 'decision' && f.body.trim().split(/\s+/).filter(Boolean).length < 3) errors.body = t.capture.errorBody
    return errors
  }
  const errors = submitted ? validate(form) : {}
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }))

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (savingRef.current) return
    setSubmitted(true)
    const errs = validate(form)
    const firstInvalid = (['title', 'url', 'body'] as const).find((k) => errs[k])
    if (firstInvalid) {
      refs[firstInvalid].current?.focus()
      return
    }
    let ref: SourceRef
    savingRef.current = true
    setSaving(true)
    try {
      if (form.kind === 'task') {
        const task = await commands.createTask({
          title: form.title,
          notes: form.body,
          status: 'todo',
          priority: form.priority,
          dueDate: form.dueDate,
          projectId: form.projectId
        })
        ref = { type: 'task', id: task.id }
        toast({
          title: t.capture.taskSaved,
          description: task.title,
          action: { label: t.common.view, onClick: () => navigate(refPath(ref)) }
        })
      } else {
        const item = await commands.captureItem({
          kind: form.kind,
          title: form.title,
          body: form.body,
          url: form.url,
          tagLabels: form.tags,
          projectId: form.projectId
        })
        ref = { type: 'item', id: item.id }
        toast({
          title: t.capture.saved(t.kinds[item.kind]),
          description: t.capture.savedHint,
          action: { label: t.common.view, onClick: () => navigate(refPath(ref)) }
        })
      }
    } catch (err) {
      saveError(err)
      return
    } finally {
      savingRef.current = false
      setSaving(false)
    }
    setForm(fresh(form.kind))
    setSubmitted(false)
    onSaved?.(ref)
    if (layout === 'page') refs.title.current?.focus()
  }

  const bodyPlaceholder =
    form.kind === 'idea'
      ? t.capture.bodyPlaceholderIdea
      : form.kind === 'decision'
        ? t.capture.bodyPlaceholderDecision
        : form.kind === 'task'
          ? t.capture.bodyPlaceholderTask
          : t.capture.bodyPlaceholder
  const hasErrors = Object.keys(errors).length > 0

  return (
    <form
      noValidate
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(e)
      }}
      aria-label={t.capture.title}
      className="flex flex-col gap-4"
    >
      <Segmented
        label={t.capture.typeLabel}
        value={form.kind}
        onChange={(kind) => {
          setForm((f) => ({ ...f, kind }))
        }}
        options={CAPTURE_KINDS.map((k) => ({ value: k, label: t.kinds[k], icon: KIND_ICON[k] }))}
        className="self-start"
      />

      {hasErrors && (
        <p role="alert" className="sr-only">
          {t.capture.errorSummary}
        </p>
      )}

      <Field label={t.capture.titleLabel} error={errors.title ?? null}>
        {({ id, describedBy, invalid }) => (
          <Input
            ref={refs.title}
            id={id}
            dir="auto"
            autoFocus={autoFocus}
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder={t.capture.titlePlaceholder}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            aria-required
            className="h-10 text-md"
          />
        )}
      </Field>

      {form.kind === 'link' && (
        <Field label={t.capture.urlLabel} error={errors.url ?? null}>
          {({ id, describedBy, invalid }) => (
            <Input
              ref={refs.url}
              id={id}
              type="url"
              dir="ltr"
              inputMode="url"
              value={form.url}
              onChange={(e) => set('url', e.target.value)}
              placeholder={t.capture.urlPlaceholder}
              aria-invalid={invalid}
              aria-describedby={describedBy}
              aria-required
            />
          )}
        </Field>
      )}

      <Field
        label={t.capture.bodyLabel}
        error={errors.body ?? null}
        {...(form.kind === 'decision' ? {} : { optional: t.common.optional })}
      >
        {({ id, describedBy, invalid }) => (
          <Textarea
            ref={refs.body}
            id={id}
            dir="auto"
            value={form.body}
            onChange={(e) => set('body', e.target.value)}
            placeholder={bodyPlaceholder}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            className={layout === 'page' ? 'min-h-44' : 'min-h-32'}
          />
        )}
      </Field>

      <div className={cn('grid gap-4', layout === 'page' ? 'md:grid-cols-2' : 'sm:grid-cols-2')}>
        {form.kind === 'task' ? (
          <>
            <Field label={t.capture.dueLabel} optional={t.common.optional}>
              {({ id }) => <DateField id={id} value={form.dueDate} onChange={(v) => set('dueDate', v)} />}
            </Field>
            <Field label={t.capture.priorityLabel}>
              {({ id }) => (
                <Segmented
                  id={id}
                  size="sm"
                  label={t.capture.priorityLabel}
                  value={form.priority}
                  onChange={(v) => set('priority', v)}
                  options={TASK_PRIORITIES.map((p) => ({ value: p, label: t.priority[p] }))}
                  className="self-start"
                />
              )}
            </Field>
          </>
        ) : (
          <Field label={t.capture.tagsLabel} optional={t.common.optional} hint={t.capture.tagsHint}>
            {({ id, describedBy }) => (
              <TagInput
                id={id}
                value={form.tags}
                onChange={(tags) => set('tags', tags)}
                suggestions={tagsByUsage(data).map((x) => x.tag.label)}
                placeholder={t.capture.tagsPlaceholder}
                removeLabel={t.capture.removeTag}
                describedBy={describedBy}
              />
            )}
          </Field>
        )}
        <Field label={t.capture.projectLabel} optional={t.common.optional}>
          {({ id }) => <ProjectSelect id={id} value={form.projectId} onChange={(v) => set('projectId', v)} />}
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line-subtle pt-4">
        <p className="flex min-w-0 flex-1 items-start gap-2 text-xs text-fg-subtle">
          <HardDrive size={13} className="mt-0.5 shrink-0" aria-hidden />
          <span>{t.capture.persistenceNote}</span>
        </p>
        <div className="flex items-center gap-2">
          {onCancel && (
            <Button variant="ghost" onClick={onCancel}>
              {t.common.cancel}
            </Button>
          )}
          <span className="hidden items-center gap-1 text-xs text-fg-subtle lg:inline-flex" aria-hidden>
            <Kbd>Ctrl</Kbd>
            <Kbd>Enter</Kbd>
          </span>
          <Button variant="primary" type="submit" loading={saving} aria-keyshortcuts="Control+Enter">
            {t.capture.save}
          </Button>
        </div>
      </div>
    </form>
  )
}
