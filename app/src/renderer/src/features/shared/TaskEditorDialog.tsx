import { useEffect, useRef, useState, type FormEvent } from 'react'
import { TASK_PRIORITIES, TASK_STATUSES, type Id, type Task } from '@shared/domain'
import { Button, Dialog, Field, Input, Kbd, Segmented, Textarea, useToast } from '@/design-system/components'
import { useI18n } from '@/state/preferences'
import { useWorkspace, type TaskInput } from '@/state/workspace'
import { RelatedContent } from '@/features/memory/RelatedContent'
import { relatedForTask } from '@/state/memory'
import { DateField } from './DateField'
import { ProjectSelect } from './ProjectSelect'
import { validateTitle } from './validation'
import { useSaveError } from './useSaveError'

export interface TaskEditorState {
  open: boolean
  /** Existing task to edit; absent for creation. */
  task?: Task
  defaults?: Partial<TaskInput>
}

const blank = (defaults?: Partial<TaskInput>): TaskInput => ({
  title: '',
  notes: '',
  status: 'todo',
  priority: 'medium',
  dueDate: null,
  projectId: null,
  ...defaults
})

/** Create or edit a task. Shared by Tasks, Projects and the Dashboard. */
export function TaskEditorDialog({
  state,
  onClose,
  onSaved
}: {
  state: TaskEditorState
  onClose: () => void
  onSaved?: (id: Id) => void
}) {
  const { t } = useI18n()
  const { data, commands } = useWorkspace()
  const toast = useToast()
  const [form, setForm] = useState<TaskInput>(() => blank(state.defaults))
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const saveError = useSaveError()
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!state.open) return
    const task = state.task
    setForm(
      task
        ? {
            title: task.title,
            notes: task.notes,
            status: task.status,
            priority: task.priority,
            dueDate: task.dueDate,
            projectId: task.projectId
          }
        : blank(state.defaults)
    )
    setSubmitted(false)
  }, [state])

  const titleError = submitted ? validateTitle(form.title) : null
  const set = <K extends keyof TaskInput>(key: K, value: TaskInput[K]) => setForm((f) => ({ ...f, [key]: value }))

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (saving) return
    setSubmitted(true)
    if (validateTitle(form.title)) {
      titleRef.current?.focus()
      return
    }
    setSaving(true)
    try {
      if (state.task) {
        await commands.updateTask(state.task.id, form)
        toast({ title: t.tasks.updated, description: form.title.trim() })
        onSaved?.(state.task.id)
      } else {
        const task = await commands.createTask(form)
        toast({ title: t.tasks.created, description: task.title })
        onSaved?.(task.id)
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
      onOpenChange={(open) => !open && onClose()}
      title={state.task ? t.tasks.editTitle : t.tasks.createTitle}
      footer={
        <>
          <span className="me-auto hidden items-center gap-1 text-xs text-fg-subtle sm:flex">
            <Kbd>Ctrl</Kbd>
            <Kbd>Enter</Kbd>
          </span>
          <Button variant="ghost" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button variant="primary" type="submit" form="task-editor" loading={saving}>
            {state.task ? t.common.save : t.common.create}
          </Button>
        </>
      }
    >
      <form
        id="task-editor"
        noValidate
        onSubmit={submit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(e)
        }}
        className="flex flex-col gap-4"
      >
        <Field label={t.tasks.titleLabel} error={titleError === 'empty' ? t.tasks.errorTitle : titleError === 'long' ? t.capture.errorTitleLong : null}>
          {({ id, describedBy, invalid }) => (
            <Input
              ref={titleRef}
              id={id}
              dir="auto"
              autoFocus
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder={t.tasks.titlePlaceholder}
              aria-invalid={invalid}
              aria-describedby={describedBy}
              aria-required
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.common.status}>
            {({ id }) => (
              <Segmented
                id={id}
                label={t.common.status}
                value={form.status}
                onChange={(v) => set('status', v)}
                options={TASK_STATUSES.map((s) => ({ value: s, label: t.taskStatus[s] }))}
                size="sm"
              />
            )}
          </Field>
          <Field label={t.common.priority}>
            {({ id }) => (
              <Segmented
                id={id}
                label={t.common.priority}
                value={form.priority}
                onChange={(v) => set('priority', v)}
                options={TASK_PRIORITIES.map((p) => ({ value: p, label: t.priority[p] }))}
                size="sm"
              />
            )}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.tasks.dueLabel} optional={t.common.optional}>
            {({ id, describedBy }) => <DateField id={id} value={form.dueDate} onChange={(v) => set('dueDate', v)} describedBy={describedBy} />}
          </Field>
          <Field label={t.common.project} optional={t.common.optional}>
            {({ id }) => <ProjectSelect id={id} value={form.projectId} onChange={(v) => set('projectId', v)} />}
          </Field>
        </div>
        <Field label={t.tasks.notesLabel} optional={t.common.optional}>
          {({ id }) => (
            <Textarea
              id={id}
              dir="auto"
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder={t.tasks.notesPlaceholder}
              className="min-h-20"
            />
          )}
        </Field>
      </form>
      {state.task && (
        <div className="mt-5 border-t border-line-subtle pt-4">
          <RelatedContent groups={relatedForTask(data, state.task)} />
        </div>
      )}
    </Dialog>
  )
}
