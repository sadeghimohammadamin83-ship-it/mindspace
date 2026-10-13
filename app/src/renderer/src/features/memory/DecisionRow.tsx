import type { Decision } from '@shared/domain'
import { Tag } from '@/design-system/components'
import { KindIcon, OriginMark } from '@/features/shared/meta'
import { ProjectLink } from '@/features/shared/TaskRow'
import { useI18n } from '@/state/preferences'
import { useWorkspace } from '@/state/workspace'
import { DecisionStatusBadge } from './DecisionStatus'

/** A decision as a list row: title (opens it), status, date and a short summary of what was decided. */
export function DecisionRow({
  decision,
  onOpen,
  showProject = true
}: {
  decision: Decision
  onOpen: (d: Decision) => void
  showProject?: boolean
}) {
  const { fmt } = useI18n()
  const { data } = useWorkspace()
  return (
    <article className="group relative flex gap-3 rounded-md px-3 py-3 transition-colors hover:bg-hover/60">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-line-subtle bg-raised">
        <KindIcon kind="decision" size={14} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="min-w-0 flex-1 truncate text-base font-medium text-fg" dir="auto">
            <button
              type="button"
              onClick={() => onOpen(decision)}
              className="max-w-full truncate rounded-sm text-start after:absolute after:inset-0 after:content-['']"
            >
              {decision.title}
            </button>
          </h3>
          <OriginMark origin={decision.origin} />
          <DecisionStatusBadge status={decision.status} />
        </div>
        <p className="mt-0.5 line-clamp-2 text-sm text-fg-muted" dir="auto">
          {decision.decision}
        </p>
        <div className="relative z-10 mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-fg-subtle">
          <time dateTime={decision.decidedOn ?? decision.updatedAt}>
            {decision.decidedOn ? fmt.date(decision.decidedOn) : fmt.relative(decision.updatedAt)}
          </time>
          {showProject && <ProjectLink id={decision.projectId} />}
          {decision.tagIds.slice(0, 3).map((id) => {
            const tag = data.tags.find((x) => x.id === id)
            return tag ? <Tag key={id}>{tag.label}</Tag> : null
          })}
        </div>
      </div>
    </article>
  )
}
