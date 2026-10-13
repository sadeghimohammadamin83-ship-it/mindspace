import { useEffect, useRef, useState, type FormEvent } from 'react'
import { PROJECT_STATUSES, type Project, type ProjectStatus } from '@shared/domain'
import { Button, Dialog, Field, Input, Segmented, Textarea, useToast } from '@/design-system/components'
import { validateTitle } from '@/features/shared/validation'
import { useSaveError } from '@/features/shared/useSaveError'
import { normalizeText } from '@/lib/text'
import { useI18n } from '@/state/preferences'
import { useWorkspace } from '@/state/workspace'

export function ProjectCreateDialog({
  open,
  onClose,
  onCreated
}: {
  open: boolean
  onClose: () => void
  onCreated: (project: Project) => void
}) {
  const { t } = useI18n()
  const { data, commands } = useWorkspace()
  const toast = useToast()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<ProjectStatus>('active')
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const saveError = useSaveError()
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setName('')
      setDescription('')
      setStatus('active')
      setSubmitted(false)
    }
  }, [open])

  const nameError = (() => {
    const err = validateTitle(name)
    if (err === 'empty') return t.projects.errorName
    if (err === 'long') return t.capture.errorTitleLong
    if (data.projects.some((p) => normalizeText(p.name) === normalizeText(name))) return t.projects.errorNameTaken
    return null
  })()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (saving) return
    setSubmitted(true)
    if (nameError) {
      nameRef.current?.focus()
      return
    }
    setSaving(true)
    try {
      const project = await commands.createProject({ name, description, status })
      toast({ title: t.projects.created, description: project.name })
      onCreated(project)
    } catch (err) {
      saveError(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t.projects.createTitle}
      description={t.projects.createDescription}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button variant="primary" type="submit" form="project-create" loading={saving}>
            {t.common.create}
          </Button>
        </>
      }
    >
      <form
        id="project-create"
        noValidate
        onSubmit={submit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(e)
        }}
        className="flex flex-col gap-4"
      >
        <Field label={t.projects.nameLabel} error={submitted ? nameError : null}>
          {({ id, describedBy, invalid }) => (
            <Input
              ref={nameRef}
              id={id}
              dir="auto"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.projects.namePlaceholder}
              aria-invalid={invalid}
              aria-describedby={describedBy}
              aria-required
            />
          )}
        </Field>
        <Field label={t.projects.descriptionLabel} optional={t.common.optional}>
          {({ id }) => (
            <Textarea
              id={id}
              dir="auto"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t.projects.descriptionPlaceholder}
              className="min-h-24"
            />
          )}
        </Field>
        <Field label={t.projects.statusLabel}>
          {({ id }) => (
            <Segmented
              id={id}
              size="sm"
              label={t.projects.statusLabel}
              value={status}
              onChange={setStatus}
              options={PROJECT_STATUSES.map((s) => ({ value: s, label: t.projectStatus[s] }))}
              className="self-start"
            />
          )}
        </Field>
      </form>
    </Dialog>
  )
}
