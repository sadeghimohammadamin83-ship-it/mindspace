import { Link } from 'react-router'
import { FolderKanban, Unlink } from 'lucide-react'
import type { SourceRef } from '@shared/domain'
import { IconButton } from '@/design-system/components'
import { refPath } from '@/app/navigation'
import { KindIcon } from '@/features/shared/meta'
import { useI18n } from '@/state/preferences'
import type { RelatedEntry, RelatedGroup } from '@/state/memory'
import { DecisionStatusBadge } from './DecisionStatus'

const refOf = (e: RelatedEntry): SourceRef => ({ type: e.type, id: e.record.id })
const titleOf = (e: RelatedEntry): string => (e.type === 'project' ? e.record.name : e.record.title)

function EntryMeta({ entry }: { entry: RelatedEntry }) {
  const { t, fmt } = useI18n()
  switch (entry.type) {
    case 'project':
      return <span>{t.projectStatus[entry.record.status]}</span>
    case 'item':
      return (
        <span>
          {t.kinds[entry.record.kind]} · {fmt.relative(entry.record.updatedAt)}
        </span>
      )
    case 'task':
      return (
        <span>
          {t.kinds.task} · {t.taskStatus[entry.record.status]}
          {entry.record.dueDate ? ` · ${fmt.date(entry.record.dueDate)}` : ''}
        </span>
      )
    case 'decision':
      return (
        <>
          <DecisionStatusBadge status={entry.record.status} />
          {entry.record.decidedOn && <span>{fmt.date(entry.record.decidedOn)}</span>}
        </>
      )
  }
}

function EntryIcon({ entry }: { entry: RelatedEntry }) {
  if (entry.type === 'project') return <FolderKanban size={14} strokeWidth={1.75} aria-hidden className="text-fg-subtle" />
  return <KindIcon kind={entry.type === 'item' ? entry.record.kind : entry.type} size={14} />
}

/**
 * A list of linked records: type icon, title, useful metadata and an optional
 * unlink button. Titles navigate to the record. Used by notes, tasks,
 * projects and decisions so links look the same everywhere.
 */
export function RelatedList({
  entries,
  onUnlink
}: {
  entries: RelatedEntry[]
  /** When given, each row shows an unlink button; the records themselves are never deleted. */
  onUnlink?: (entry: RelatedEntry) => void
}) {
  const { t } = useI18n()
  return (
    <ul className="flex flex-col divide-y divide-line-subtle rounded-lg border border-line-subtle bg-surface">
      {entries.map((entry) => (
        <li key={`${entry.type}:${entry.record.id}`} className="flex items-center gap-3 px-3 py-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-line-subtle bg-raised">
            <EntryIcon entry={entry} />
          </span>
          <div className="min-w-0 flex-1">
            <Link to={refPath(refOf(entry))} className="block truncate text-base font-medium text-fg hover:text-accent-text" dir="auto">
              {titleOf(entry)}
            </Link>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-subtle">
              <EntryMeta entry={entry} />
            </div>
          </div>
          {onUnlink && (
            <IconButton
              icon={Unlink}
              size="sm"
              label={t.memory.unlinkLabel(titleOf(entry))}
              onClick={() => onUnlink(entry)}
            />
          )}
        </li>
      ))}
    </ul>
  )
}

/** Related records grouped by relationship. Empty groups are left out. */
export function RelatedContent({
  groups,
  heading = true,
  onUnlink
}: {
  groups: RelatedGroup[]
  heading?: boolean
  onUnlink?: (group: RelatedGroup['key'], entry: RelatedEntry) => void
}) {
  const { t } = useI18n()
  const label: Record<RelatedGroup['key'], string> = {
    project: t.memory.relatedProject,
    notes: t.memory.relatedNotes,
    tasks: t.memory.relatedTasks,
    decisions: t.memory.relatedDecisions,
    replaces: t.memory.relatedReplaces,
    supersededBy: t.memory.relatedSupersededBy
  }
  const shown = groups.filter((g) => g.entries.length > 0)
  return (
    <section aria-label={t.memory.relatedTitle} className="flex flex-col gap-4">
      {heading && <h3 className="text-sm font-semibold text-fg">{t.memory.relatedTitle}</h3>}
      {shown.length === 0 ? (
        <p className="text-sm text-fg-muted">{t.memory.relatedEmpty}</p>
      ) : (
        shown.map((g) => (
          <div key={g.key} className="flex flex-col gap-1.5">
            <h4 className="text-xs font-medium text-fg-subtle">{label[g.key]}</h4>
            <RelatedList entries={g.entries} {...(onUnlink ? { onUnlink: (e: RelatedEntry) => onUnlink(g.key, e) } : {})} />
          </div>
        ))
      )}
    </section>
  )
}
