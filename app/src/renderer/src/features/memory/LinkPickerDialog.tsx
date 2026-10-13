import { useMemo, useState } from 'react'
import { Button, Dialog, Input } from '@/design-system/components'
import { normalizeText } from '@/lib/text'
import { useI18n } from '@/state/preferences'
import { useSaveError } from '@/features/shared/useSaveError'

export interface PickerOption {
  id: string
  title: string
  subtitle?: string | undefined
}

/**
 * Pick one existing record to link. The pick button of the chosen row shows
 * progress, and other rows are disabled meanwhile, so a link is never sent twice.
 */
export function LinkPickerDialog({
  open,
  title,
  description,
  searchLabel,
  emptyText,
  options,
  onPick,
  onClose
}: {
  open: boolean
  title: string
  description?: string | undefined
  searchLabel: string
  emptyText: string
  options: PickerOption[]
  onPick: (id: string) => Promise<void>
  onClose: () => void
}) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const saveError = useSaveError()

  const shown = useMemo(() => {
    const words = normalizeText(query).split(' ').filter(Boolean)
    if (words.length === 0) return options
    return options.filter((o) => {
      const hay = normalizeText(`${o.title} ${o.subtitle ?? ''}`)
      return words.every((w) => hay.includes(w))
    })
  }, [options, query])

  const pick = async (id: string) => {
    if (busyId) return
    setBusyId(id)
    try {
      await onPick(id)
      setQuery('')
      onClose()
    } catch (err) {
      saveError(err)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busyId && onClose()} title={title} {...(description ? { description } : {})}>
      {options.length === 0 ? (
        <p className="py-6 text-center text-sm text-fg-muted">{emptyText}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <Input
            aria-label={searchLabel}
            placeholder={searchLabel}
            dir="auto"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {shown.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg-muted">{t.memory.notePickerNoMatch}</p>
          ) : (
            <ul className="flex max-h-80 flex-col divide-y divide-line-subtle overflow-y-auto rounded-lg border border-line-subtle">
              {shown.map((o) => (
                <li key={o.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base text-fg" dir="auto">
                      {o.title}
                    </p>
                    {o.subtitle && <p className="truncate text-xs text-fg-subtle">{o.subtitle}</p>}
                  </div>
                  <Button size="sm" loading={busyId === o.id} disabled={busyId !== null && busyId !== o.id} onClick={() => void pick(o.id)}>
                    {t.memory.link}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Dialog>
  )
}
