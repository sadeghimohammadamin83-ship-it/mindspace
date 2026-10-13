import { CalendarClock } from 'lucide-react'
import type { IsoDate } from '@shared/domain'
import { cn } from '@/lib/cn'
import { useI18n } from '@/state/preferences'

export function DueLabel({ date, done, compact }: { date: IsoDate | null; done?: boolean; compact?: boolean }) {
  const { t, fmt } = useI18n()
  if (!date) {
    return compact ? null : <span className="text-xs text-fg-subtle">{t.dates.noDueDate}</span>
  }
  const { days, tone } = fmt.due(date)
  const label =
    days === 0 ? t.dates.today : days === 1 ? t.dates.tomorrow : days === -1 ? t.dates.yesterday : fmt.date(date)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs whitespace-nowrap',
        done ? 'text-fg-subtle' : tone === 'overdue' ? 'text-danger' : tone === 'today' ? 'text-warning' : 'text-fg-muted'
      )}
    >
      <CalendarClock size={12} strokeWidth={1.75} aria-hidden />
      <span className="sr-only">{t.common.due}: </span>
      {label}
      {!done && tone === 'overdue' && <span className="sr-only"> ({t.dates.overdue})</span>}
    </span>
  )
}
