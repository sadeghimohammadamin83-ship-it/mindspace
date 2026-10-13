import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useNavigate } from 'react-router'
import {
  Bell,
  CheckCircle2,
  FolderPlus,
  Gavel,
  Link2,
  ListPlus,
  PenLine,
  RotateCcw,
  SquarePen,
  Unlink,
  type LucideIcon
} from 'lucide-react'
import type { ActivityEvent, ActivityKind } from '@shared/domain'
import { Popover, Tooltip } from '@/design-system/components'
import { TRANSITION } from '@/design-system/motion'
import { cn } from '@/lib/cn'
import { useI18n } from '@/state/preferences'
import { useWorkspace } from '@/state/workspace'
import type { Messages } from '@/lib/i18n/en'
import { refPath } from './navigation'

export const ACTIVITY_ICON: Record<ActivityKind, LucideIcon> = {
  item_captured: PenLine,
  task_created: ListPlus,
  task_completed: CheckCircle2,
  task_reopened: RotateCcw,
  task_updated: SquarePen,
  project_created: FolderPlus,
  project_updated: SquarePen,
  item_updated: SquarePen,
  item_project_linked: Link2,
  item_project_unlinked: Unlink,
  task_project_linked: Link2,
  task_project_unlinked: Unlink,
  decision_created: Gavel,
  decision_updated: SquarePen,
  decision_accepted: CheckCircle2,
  decision_rejected: Gavel,
  decision_superseded: RotateCcw,
  decision_reopened: RotateCcw,
  decision_link_added: Link2,
  decision_link_removed: Unlink
}

/** One-line, human-readable description of an event (uses the related record's title when it has one). */
export function describeActivity(t: Messages, event: ActivityEvent): string {
  const related = event.meta?.related?.title ?? ''
  if (event.kind in t.activityRelated) {
    return t.activityRelated[event.kind as keyof Messages['activityRelated']](event.subject, related)
  }
  return t.activity[event.kind as keyof Messages['activity']](event.subject)
}

export function ActivityLine({ event, onSelect }: { event: ActivityEvent; onSelect: (e: ActivityEvent) => void }) {
  const { t, fmt } = useI18n()
  const Icon = ACTIVITY_ICON[event.kind]
  return (
    <button
      type="button"
      onClick={() => onSelect(event)}
      className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-start hover:bg-hover"
    >
      <Icon
        size={14}
        strokeWidth={1.75}
        aria-hidden
        className={cn('mt-0.5 shrink-0', event.kind === 'task_completed' || event.kind === 'decision_accepted' ? 'text-success' : 'text-fg-subtle')}
      />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-sm text-fg">{describeActivity(t, event)}</span>
        <time dateTime={event.at} className="text-xs text-fg-subtle">
          {fmt.relative(event.at)}
        </time>
      </span>
    </button>
  )
}

/** Top-bar activity control: shows what changed in this session, with an unread count. */
export function ActivityPopover() {
  const { t, fmt } = useI18n()
  const { data, commands, activitySeenAt } = useWorkspace()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const unread = data.activity.filter((a) => Date.parse(a.at) > activitySeenAt).length
  const session = data.activity.filter((a) => a.origin === 'session').slice(0, 12)
  const earlier = data.activity.filter((a) => a.origin === 'sample').slice(0, 4)

  const select = (e: ActivityEvent) => {
    setOpen(false)
    navigate(refPath(e.ref))
  }

  return (
    <Popover
      label={t.topbar.activityTitle}
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) commands.markActivityRead()
      }}
      className="w-80"
      trigger={
        <Tooltip content={t.topbar.activity}>
            <button
              type="button"
              aria-label={unread ? t.topbar.activityUnread(fmt.number(unread)) : t.topbar.activity}
              className="relative inline-flex size-8.5 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg data-[state=open]:bg-hover data-[state=open]:text-fg"
            >
              <Bell size={17} strokeWidth={1.75} aria-hidden />
              <AnimatePresence>
                {unread > 0 && (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.6, transition: TRANSITION.fast }}
                    transition={TRANSITION.spring}
                    className="absolute end-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-2xs font-semibold text-accent-fg"
                    aria-hidden
                  >
                    {fmt.number(unread)}
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
        </Tooltip>
      }
    >
      <div className="flex items-center justify-between border-b border-line-subtle px-3.5 py-2.5">
        <p className="text-sm font-semibold text-fg">{t.topbar.activityTitle}</p>
        {unread > 0 && (
          <button type="button" onClick={commands.markActivityRead} className="rounded-sm text-xs text-accent-text hover:underline">
            {t.topbar.markRead}
          </button>
        )}
      </div>
      <div className="max-h-96 overflow-y-auto p-1.5">
        <p className="px-2.5 pt-1 pb-1 text-2xs font-semibold tracking-wide text-fg-subtle uppercase">{t.topbar.activitySession}</p>
        {session.length === 0 ? (
          <p className="px-2.5 pb-2 text-sm text-fg-muted">{t.topbar.activityEmpty}</p>
        ) : (
          <AnimatePresence initial={false}>
            {session.map((e) => (
              <motion.div
                key={e.id}
                layout="position"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ opacity: TRANSITION.base, y: TRANSITION.base, layout: TRANSITION.layout }}
              >
                <ActivityLine event={e} onSelect={select} />
              </motion.div>
            ))}
          </AnimatePresence>
        )}
        {earlier.length > 0 && (
          <>
            <p className="mt-1 border-t border-line-subtle px-2.5 pt-2.5 pb-1 text-2xs font-semibold tracking-wide text-fg-subtle uppercase">
              {t.topbar.activityEarlier}
            </p>
            {earlier.map((e) => (
              <ActivityLine key={e.id} event={e} onSelect={select} />
            ))}
          </>
        )}
      </div>
    </Popover>
  )
}
