import { TAG_MAX } from '@shared/limits'
import { useState, type KeyboardEvent } from 'react'
import { inputClass, Tag } from '@/design-system/components'
import { cn } from '@/lib/cn'
import { normalizeText } from '@/lib/text'

/** Free-form tag entry with suggestions from existing tags. */
export function TagInput({
  id,
  value,
  onChange,
  suggestions,
  placeholder,
  removeLabel,
  describedBy
}: {
  id: string
  value: string[]
  onChange: (tags: string[]) => void
  suggestions: string[]
  placeholder: string
  removeLabel: (tag: string) => string
  describedBy?: string | undefined
}) {
  const [draft, setDraft] = useState('')
  const listId = `${id}-suggestions`

  const add = (raw: string) => {
    const label = raw.replace(/^#/, '').trim()
    if (!label) return
    if (!value.some((v) => normalizeText(v) === normalizeText(label))) onChange([...value, label])
    setDraft('')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'Enter' || e.key === ',' || e.key === '،') && draft.trim()) {
      e.preventDefault()
      add(draft)
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1))
    }
  }

  const available = suggestions.filter((s) => !value.some((v) => normalizeText(v) === normalizeText(s)))

  return (
    <div className={cn(inputClass, 'flex min-h-8.5 flex-wrap items-center gap-1.5 px-2 py-1 focus-within:border-accent-line')}>
      {value.map((tag) => (
        <Tag key={tag} onRemove={() => onChange(value.filter((v) => v !== tag))} removeLabel={removeLabel(tag)}>
          {tag}
        </Tag>
      ))}
      <input
        id={id}
        value={draft}
        maxLength={TAG_MAX}
        list={listId}
        onChange={(e) => {
          const v = e.target.value
          // Picking a suggestion from the datalist inserts it whole.
          if (available.includes(v)) add(v)
          else setDraft(v)
        }}
        onKeyDown={onKeyDown}
        onBlur={() => draft.trim() && add(draft)}
        placeholder={value.length ? '' : placeholder}
        aria-describedby={describedBy}
        className="h-6 min-w-24 flex-1 bg-transparent px-1 text-base text-fg outline-none focus-visible:outline-none"
      />
      <datalist id={listId}>
        {available.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  )
}
