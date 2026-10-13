import { useEffect, useId, useState } from 'react'
import { Pencil } from 'lucide-react'
import type { Id } from '@shared/domain'
import { Button, IconButton, Tag, useToast } from '@/design-system/components'
import { TagInput } from '@/features/shared/TagInput'
import { useSaveError } from '@/features/shared/useSaveError'
import { useI18n } from '@/state/preferences'
import { useWorkspace } from '@/state/workspace'

/**
 * Shows a record's tags with an inline editor. Saving sends the whole label
 * list; existing tags are reused (same normalised label) and new ones created.
 */
export function TagEditor({
  tagIds,
  onSave,
  onTagClick
}: {
  tagIds: Id[]
  onSave: (labels: string[]) => Promise<unknown>
  onTagClick?: (tagId: Id) => void
}) {
  const { t } = useI18n()
  const { data } = useWorkspace()
  const toast = useToast()
  const saveError = useSaveError()
  const inputId = useId()
  const labels = tagIds.map((id) => data.tags.find((x) => x.id === id)?.label).filter((l): l is string => Boolean(l))
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(labels)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!editing) setDraft(labels)
  }, [editing, labels.join('\u0000')]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (saving) return
    setSaving(true)
    try {
      await onSave(draft)
      toast({ title: t.memory.tagsSaved, tone: 'success' })
      setEditing(false)
    } catch (err) {
      saveError(err)
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-2">
        <TagInput
          id={inputId}
          value={draft}
          onChange={setDraft}
          suggestions={data.tags.map((x) => x.label)}
          placeholder={t.memory.tagsPlaceholder}
          removeLabel={t.memory.removeTag}
        />
        <div className="flex gap-2">
          <Button size="sm" variant="primary" loading={saving} onClick={() => void save()}>
            {t.common.save}
          </Button>
          <Button size="sm" variant="ghost" disabled={saving} onClick={() => setEditing(false)}>
            {t.common.cancel}
          </Button>
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tagIds.map((id) => {
        const tag = data.tags.find((x) => x.id === id)
        return tag ? (
          <Tag key={id} {...(onTagClick ? { onClick: () => onTagClick(id) } : {})}>
            {tag.label}
          </Tag>
        ) : null
      })}
      <IconButton icon={Pencil} size="sm" label={t.memory.editTags} onClick={() => setEditing(true)} />
    </div>
  )
}
