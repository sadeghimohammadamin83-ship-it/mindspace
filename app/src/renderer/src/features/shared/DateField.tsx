import { X } from 'lucide-react'
import { Input } from '@/design-system/components'
import { isValidIsoDate } from '@/lib/dates'
import { useI18n } from '@/state/preferences'

/**
 * Native date input (the picker itself is Gregorian) with a preview of the
 * chosen date in the user's calendar.
 */
export function DateField({
  id,
  value,
  onChange,
  describedBy
}: {
  id: string
  value: string | null
  onChange: (v: string | null) => void
  describedBy?: string | undefined
}) {
  const { t, fmt } = useI18n()
  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        type="date"
        dir="ltr"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value && isValidIsoDate(e.target.value) ? e.target.value : null)}
        aria-describedby={describedBy}
        className="w-40 [color-scheme:dark]"
      />
      {value && (
        <>
          <span className="truncate text-sm text-fg-muted">{fmt.date(value, 'long')}</span>
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={t.tasks.clearDue}
            className="rounded-sm p-1 text-fg-subtle hover:bg-hover hover:text-fg"
          >
            <X size={13} aria-hidden />
          </button>
        </>
      )}
    </div>
  )
}
