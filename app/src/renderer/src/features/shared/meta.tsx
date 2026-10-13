import { Bookmark, CheckSquare, FileText, Gavel, Lightbulb, Link2, type LucideIcon } from 'lucide-react'
import type { ItemKind, Origin, ProjectStatus, TaskPriority, TaskStatus } from '@shared/domain'
import { Badge, Tooltip, type Tone } from '@/design-system/components'
import { useI18n } from '@/state/preferences'

export const KIND_ICON: Record<ItemKind | 'task', LucideIcon> = {
  note: FileText,
  idea: Lightbulb,
  link: Link2,
  decision: Gavel,
  task: CheckSquare
}

export const PROJECT_STATUS_TONE: Record<ProjectStatus, Tone> = {
  planning: 'info',
  active: 'success',
  on_hold: 'warning',
  completed: 'neutral'
}

export const PRIORITY_TONE: Record<TaskPriority, Tone> = {
  high: 'danger',
  medium: 'warning',
  low: 'neutral'
}

export const TASK_STATUS_TONE: Record<TaskStatus, Tone> = {
  todo: 'neutral',
  in_progress: 'info',
  done: 'success'
}

export function KindIcon({ kind, size = 15 }: { kind: ItemKind | 'task'; size?: number }) {
  const Icon = KIND_ICON[kind]
  return <Icon size={size} strokeWidth={1.75} aria-hidden className={kind === 'decision' || kind === 'idea' ? 'text-accent-text' : 'text-fg-subtle'} />
}

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const { t } = useI18n()
  return (
    <Badge tone={PROJECT_STATUS_TONE[status]} dot>
      {t.projectStatus[status]}
    </Badge>
  )
}

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const { t } = useI18n()
  return (
    <Badge tone={PRIORITY_TONE[priority]}>
      <span className="sr-only">{t.common.priority}: </span>
      {t.priority[priority]}
    </Badge>
  )
}

/** Marks records created in this session (sample records are the default). */
export function OriginMark({ origin }: { origin: Origin }) {
  const { t } = useI18n()
  if (origin === 'sample') return null
  return (
    <Tooltip content={t.app.newThisSession}>
      <span className="inline-flex">
        <Badge tone="accent" icon={Bookmark}>
          <span className="sr-only">{t.app.newThisSession}</span>
          <span aria-hidden>{t.app.newBadge}</span>
        </Badge>
      </span>
    </Tooltip>
  )
}
