import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Decision, DecisionStatus, Id } from '@shared/domain'
import { Button, Dialog, Field, Input, Kbd, Segmented, Textarea, useToast } from '@/design-system/components'
import { DateField } from '@/features/shared/DateField'
import { ProjectSelect } from '@/features/shared/ProjectSelect'
import { TagInput } from '@/features/shared/TagInput'
import { useSaveError } from '@/features/shared/useSaveError'
import { validateTitle } from '@/features/shared/validation'
import { useI18n } from '@/state/preferences'
import { useWorkspace } from '@/state/workspace'

export interface DecisionEditorState {
  open: boolean
  /** Existing decision to edit; absent when creating. */
  decision?: Decision
  defaults?: { projectId?: Id | null; noteIds?: Id[]; taskIds?: Id[] }
}

type CreateStatus = Exclude<DecisionStatus, 'superseded'>

interface Form {
  title: string
  context: string
  decision: string
  rationale: string
  alternatives: string
  consequences: string
  status: CreateStatus
  decidedOn: string | null
  projectId: Id | null
  tags: string[]
}

const blank = (projectId: Id | null = null): Form => ({
  title: '',
  context: '',
  decision: '',
  rationale: '',
  alternatives: '',
  consequences: '',
  status: 'proposed',
  decidedOn: null,
  projectId,
  tags: []
})

/** Create or edit a decision record. Status changes of existing decisions happen in the detail view. */
export function DecisionEditorDialog({
  state,
  onClose,
  onSaved
}: {
  state: DecisionEditorState
  onClose: () => void
  onSaved?: (id: Id) => void
}) {
  const { t } = useI18n()
  const { data, commands } = useWorkspace()
  const toast = useToast()
  const saveError = useSaveError()
  const [form, setForm] = useState<Form>(() => blank(state.defaults?.projectId ?? null))
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const decisionRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!state.open) return
    const d = state.decision
    setForm(
      d
        ? {
            title: d.title,
            context: d.context,
            decision: d.decision,
            rationale: d.rationale,
            alternatives: d.alternatives,
            consequences: d.consequences,
            status: d.status === 'superseded' ? 'accepted' : d.status,
            decidedOn: d.decidedOn,
            projectId: d.projectId,
            tags: d.tagIds.map((id) => data.tags.find((x) => x.id === id)?.label).filter((l): l is string => Boolean(l))
          }
        : blank(state.defaults?.projectId ?? null)
    )
    setSubmitted(false)
  }, [state]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }))
  const titleError = submitted ? validateTitle(form.title) : null
  const decisionError = submitted && !form.decision.trim() ? t.memory.errorDecisionText : null

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (saving) return
    setSubmitted(true)
    if (validateTitle(form.title)) return void titleRef.current?.focus()
    if (!form.decision.trim()) return void decisionRef.current?.focus()
    setSaving(true)
    try {
      const fields = {
        title: form.title,
        context: form.context,
        decision: form.decision,
        rationale: form.rationale,
        alternatives: form.alternatives,
        consequences: form.consequences,
        decidedOn: form.decidedOn,
        projectId: form.projectId,
        tagLabels: form.tags
      }
      if (state.decision) {
        await commands.updateDecision(state.decision.id, fields)
        toast({ title: t.memory.decisionSaved, description: form.title.trim(), tone: 'success' })
        onSaved?.(state.decision.id)
      } else {
        const created = await commands.createDecision({
          ...fields,
          status: form.status,
          noteIds: state.defaults?.noteIds ?? [],
          taskIds: state.defaults?.taskIds ?? []
        })
        toast({ title: t.memory.decisionCreated, description: created.title, tone: 'success' })
        onSaved?.(created.id)
      }
      onClose()
    } catch (err) {
      saveError(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={state.open}
      onOpenChange={(open) => !open && !saving && onClose()}
      title={state.decision ? t.memory.editDecisionTitle : t.memory.createDecisionTitle}
      width="lg"
      footer={
        <>
          <span className="me-auto hidden items-center gap-1 text-xs text-fg-subtle sm:flex">
            <Kbd>Ctrl</Kbd>
            <Kbd>Enter</Kbd>
          </span>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {t.common.cancel}
          </Button>
          <Button variant="primary" type="submit" form="decision-editor" loading={saving}>
            {state.decision ? t.common.save : t.common.create}
          </Button>
        </>
      }
    >
      <form
        id="decision-editor"
        noValidate
        onSubmit={submit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit()
        }}
        className="flex flex-col gap-4"
      >
        <Field
          label={t.memory.decisionTitleLabel}
          error={titleError === 'empty' ? t.memory.errorDecisionTitle : titleError === 'long' ? t.capture.errorTitleLong : null}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              ref={titleRef}
              id={id}
              dir="auto"
              autoFocus
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder={t.memory.decisionTitlePlaceholder}
              aria-invalid={invalid}
              aria-describedby={describedBy}
              aria-required
            />
          )}
        </Field>
        <Field label={t.memory.decisionLabel} hint={t.memory.decisionHint} error={decisionError}>
          {({ id, describedBy, invalid }) => (
            <Textarea
              ref={decisionRef}
              id={id}
              dir="auto"
              value={form.decision}
              onChange={(e) => set('decision', e.target.value)}
              aria-invalid={invalid}
              aria-describedby={describedBy}
              aria-required
              className="min-h-20"
            />
          )}
        </Field>
        <Field label={t.memory.contextLabel} hint={t.memory.contextHint} optional={t.common.optional}>
          {({ id, describedBy }) => (
            <Textarea id={id} dir="auto" value={form.context} onChange={(e) => set('context', e.target.value)} aria-describedby={describedBy} className="min-h-20" />
          )}
        </Field>
        <Field label={t.memory.rationaleLabel} hint={t.memory.rationaleHint} optional={t.common.optional}>
          {({ id, describedBy }) => (
            <Textarea id={id} dir="auto" value={form.rationale} onChange={(e) => set('rationale', e.target.value)} aria-describedby={describedBy} className="min-h-20" />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.memory.alternativesLabel} optional={t.common.optional}>
            {({ id }) => (
              <Textarea id={id} dir="auto" value={form.alternatives} onChange={(e) => set('alternatives', e.target.value)} className="min-h-20" />
            )}
          </Field>
          <Field label={t.memory.consequencesLabel} optional={t.common.optional}>
            {({ id }) => (
              <Textarea id={id} dir="auto" value={form.consequences} onChange={(e) => set('consequences', e.target.value)} className="min-h-20" />
            )}
          </Field>
        </div>
        {!state.decision && (
          <Field label={t.common.status} hint={t.memory.statusHelp[form.status]}>
            {({ id, describedBy }) => (
              <Segmented
                id={id}
                label={t.common.status}
                value={form.status}
                onChange={(v) => set('status', v)}
                options={(['proposed', 'accepted', 'rejected'] as const).map((s) => ({ value: s, label: t.memory.status[s] }))}
                size="sm"
                {...(describedBy ? {} : {})}
              />
            )}
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.memory.dateLabel} optional={t.common.optional}>
            {({ id, describedBy }) => <DateField id={id} value={form.decidedOn} onChange={(v) => set('decidedOn', v)} describedBy={describedBy} />}
          </Field>
          <Field label={t.common.project} optional={t.common.optional}>
            {({ id }) => <ProjectSelect id={id} value={form.projectId} onChange={(v) => set('projectId', v)} />}
          </Field>
        </div>
        <Field label={t.common.tags} optional={t.common.optional}>
          {({ id, describedBy }) => (
            <TagInput
              id={id}
              value={form.tags}
              onChange={(v) => set('tags', v)}
              suggestions={data.tags.map((x) => x.label)}
              placeholder={t.memory.tagsPlaceholder}
              removeLabel={t.memory.removeTag}
              describedBy={describedBy}
            />
          )}
        </Field>
      </form>
    </Dialog>
  )
}
