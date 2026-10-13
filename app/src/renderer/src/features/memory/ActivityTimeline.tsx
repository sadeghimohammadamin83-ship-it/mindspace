import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { History } from 'lucide-react'
import type { ActivityEvent, Id, SourceRef } from '@shared/domain'
import { Button, EmptyState, ErrorState, Skeleton } from '@/design-system/components'
import { ACTIVITY_ICON, describeActivity } from '@/app/ActivityPopover'
import { refPath } from '@/app/navigation'
import { cn } from '@/lib/cn'
import { useI18n } from '@/state/preferences'
import { useWorkspace } from '@/state/workspace'
import type { WorkspaceData } from '@/mocks/seed'

const PAGE = 30

/** Does the record an event points at still exist? Deleted records are shown as plain text, never as a dead link. */
export function recordExists(data: WorkspaceData, ref: SourceRef): boolean {
  switch (ref.type) {
    case 'item':
      return data.items.some((i) => i.id === ref.id)
    case 'task':
      return data.tasks.some((t) => t.id === ref.id)
    case 'project':
      return data.projects.some((p) => p.id === ref.id)
    case 'decision':
      return data.decisions.some((d) => d.id === ref.id)
  }
}

function EventTarget({ event }: { event: ActivityEvent }) {
  const { t } = useI18n()
  const { data } = useWorkspace()
  const main = event.ref
  const related = event.meta?.related
  const link = (ref: SourceRef, title: string) =>
    recordExists(data, ref) ? (
      <Link
        to={refPath(ref)}
        aria-label={t.memory.activityOpen(title)}
        className="max-w-full truncate rounded-sm text-accent-text hover:underline"
        dir="auto"
      >
        {title}
      </Link>
    ) : (
      <span className="max-w-full truncate text-fg-subtle" dir="auto" title={t.memory.activityRecordGone}>
        {title}
      </span>
    )
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
      {link(main, event.subject)}
      {related && link({ type: related.type, id: related.id }, related.title)}
    </span>
  )
}

/**
 * Project timeline, newest first. Events come from the database (written in
 * the same transaction as the change they describe), fetched in pages.
 */
export function ActivityTimeline({ projectId }: { projectId: Id }) {
  const { t, fmt } = useI18n()
  const { data, commands } = useWorkspace()
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const countRef = useRef(PAGE)
  // The newest event id changes whenever any write adds an event, which is when the timeline must refresh.
  const refreshKey = data.activity[0]?.id ?? ''

  const load = useCallback(async () => {
    try {
      const rows = await commands.loadProjectActivity({ projectId, limit: Math.min(100, Math.max(PAGE, countRef.current)) })
      setEvents(rows)
      setHasMore(rows.length >= Math.max(PAGE, countRef.current))
      setState('ready')
    } catch {
      setState('error')
    }
  }, [commands, projectId])

  useEffect(() => {
    countRef.current = PAGE
    setState('loading')
    void load()
  }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (state === 'ready') void load()
  }, [refreshKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const more = async () => {
    const last = events.at(-1)
    if (!last || loadingMore) return
    setLoadingMore(true)
    try {
      const rows = await commands.loadProjectActivity({ projectId, limit: PAGE, before: last.at })
      const known = new Set(events.map((e) => e.id))
      setEvents([...events, ...rows.filter((r) => !known.has(r.id))])
      countRef.current = events.length + rows.length
      setHasMore(rows.length >= PAGE)
    } catch {
      setState('error')
    } finally {
      setLoadingMore(false)
    }
  }

  if (state === 'loading') {
    return (
      <div className="flex flex-col gap-3" aria-busy>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    )
  }
  if (state === 'error') {
    return (
      <ErrorState
        title={t.memory.activityLoadFailed}
        action={
          <Button
            onClick={() => {
              setState('loading')
              void load()
            }}
          >
            {t.common.retry}
          </Button>
        }
      />
    )
  }
  if (events.length === 0) {
    return <EmptyState icon={History} title={t.memory.activityEmpty} description={t.memory.activityEmptyHint} />
  }

  return (
    <div>
      <ol className="relative flex flex-col gap-0.5 border-s border-line-subtle ps-0">
        {events.map((e) => {
          const Icon = ACTIVITY_ICON[e.kind]
          return (
            <li key={e.id} className="relative flex gap-3 py-2.5 ps-6">
              <span className="absolute start-0 top-3 flex size-6 -translate-x-1/2 items-center justify-center rounded-full border border-line-subtle bg-surface rtl:translate-x-1/2">
                <Icon
                  size={12}
                  strokeWidth={1.75}
                  aria-hidden
                  className={cn(e.kind === 'task_completed' || e.kind === 'decision_accepted' ? 'text-success' : 'text-fg-subtle')}
                />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-2xs font-semibold tracking-wide text-fg-subtle uppercase">{t.activityType[e.kind]}</span>
                  <time dateTime={e.at} title={fmt.date(e.at, 'long')} className="text-xs text-fg-subtle">
                    {fmt.relative(e.at)}
                  </time>
                </div>
                <p className="text-sm text-fg" dir="auto">
                  {describeActivity(t, e)}
                </p>
                <EventTarget event={e} />
              </div>
            </li>
          )
        })}
      </ol>
      <div className="mt-3 flex justify-center">
        {hasMore ? (
          <Button size="sm" loading={loadingMore} onClick={() => void more()}>
            {t.memory.activityLoadMore}
          </Button>
        ) : (
          <p className="text-xs text-fg-subtle">{t.memory.activityEnd}</p>
        )}
      </div>
    </div>
  )
}
