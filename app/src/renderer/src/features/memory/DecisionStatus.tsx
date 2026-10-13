import { CircleCheck, CircleDashed, CircleX, Replace, Info, type LucideIcon } from 'lucide-react'
import { DECISION_STATUSES, type DecisionStatus } from '@shared/domain'
import { Badge, Popover, Button, type Tone } from '@/design-system/components'
import { useI18n } from '@/state/preferences'

export const DECISION_TONE: Record<DecisionStatus, Tone> = {
  proposed: 'info',
  accepted: 'success',
  rejected: 'danger',
  superseded: 'neutral'
}

export const DECISION_ICON: Record<DecisionStatus, LucideIcon> = {
  proposed: CircleDashed,
  accepted: CircleCheck,
  rejected: CircleX,
  superseded: Replace
}

export function DecisionStatusBadge({ status }: { status: DecisionStatus }) {
  const { t } = useI18n()
  return (
    <Badge tone={DECISION_TONE[status]} icon={DECISION_ICON[status]}>
      <span className="sr-only">{t.common.status}: </span>
      {t.memory.status[status]}
    </Badge>
  )
}

/** The four statuses with one sentence each, so nobody has to guess what "superseded" means. */
export function DecisionStatusGuide() {
  const { t } = useI18n()
  return (
    <Popover
      label={t.memory.statusGuideTitle}
      align="start"
      className="w-80"
      trigger={
        <Button size="sm" variant="ghost" icon={Info}>
          {t.memory.statusGuideTitle}
        </Button>
      }
    >
      <dl className="flex flex-col gap-3 p-4">
        {DECISION_STATUSES.map((s) => (
          <div key={s}>
            <dt>
              <DecisionStatusBadge status={s} />
            </dt>
            <dd className="mt-1 text-sm text-fg-muted">{t.memory.statusHelp[s]}</dd>
          </div>
        ))}
      </dl>
    </Popover>
  )
}
