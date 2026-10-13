import { Link, useNavigate } from 'react-router'
import { AlarmClock, CalendarRange, Calculator, FileClock, FolderKanban, NotebookPen, Sunrise } from 'lucide-react'
import type { KnowledgeItem } from '@shared/domain'
import { Badge, EmptyState, Panel, Tooltip } from '@/design-system/components'
import { refPath } from '@/app/navigation'
import { sampleBriefingText } from '@/mocks/briefing'
import { ItemRow } from '@/features/shared/ItemRow'
import { ProjectStatusBadge } from '@/features/shared/meta'
import { Page, PageHeader } from '@/features/shared/PageHeader'
import { TaskEditorDialog } from '@/features/shared/TaskEditorDialog'
import { TaskRow } from '@/features/shared/TaskRow'
import { useTaskEditor } from '@/features/shared/useTaskEditor'
import { cn } from '@/lib/cn'
import { daysUntil } from '@/lib/dates'
import { useI18n, useNow } from '@/state/preferences'
import { useWorkspace } from '@/state/workspace'
import { projectStats, sortProjects, upcomingTasks, updatedWithin } from '@/state/selectors'

function ComputedBadge() {
  const { t } = useI18n()
  return (
    <Tooltip content={t.briefing.computedHint}>
      <span tabIndex={0} className="inline-flex rounded-full">
        <Badge icon={Calculator}>{t.briefing.computedBadge}</Badge>
      </span>
    </Tooltip>
  )
}

export default function BriefingPage() {
  const { t, fmt, lang } = useI18n()
  const { data } = useWorkspace()
  const navigate = useNavigate()
  const now = useNow()
  const editor = useTaskEditor()

  const week = upcomingTasks(data.tasks, now, 7)
  const focus = week.filter((x) => x.dueDate !== null && daysUntil(x.dueDate, now) <= 0)
  const next = week.filter((x) => x.dueDate !== null && daysUntil(x.dueDate, now) > 0)
  const overdue = focus.filter((x) => x.dueDate !== null && daysUntil(x.dueDate, now) < 0).length
  const updated = updatedWithin(data.items, now, 48)
  const active = sortProjects(data.projects).filter((p) => p.status === 'active')
  const openItem = (item: KnowledgeItem) => navigate(refPath({ type: 'item', id: item.id }))

  const stats = [
    { label: t.briefing.stats.dueToday, value: focus.length - overdue, tone: focus.length - overdue ? 'text-warning' : 'text-fg' },
    { label: t.briefing.stats.overdue, value: overdue, tone: overdue ? 'text-danger' : 'text-fg' },
    { label: t.briefing.stats.thisWeek, value: next.length, tone: 'text-fg' },
    { label: t.briefing.stats.updated, value: updated.length, tone: 'text-fg' }
  ]

  return (
    <Page>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5 text-sm text-accent-text">
            <Sunrise size={15} strokeWidth={1.75} aria-hidden />
            {t.briefing.title}
          </span>
        }
        title={fmt.weekdayDate(now)}
        description={t.briefing.description}
        actions={<ComputedBadge />}
      />

      <dl className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line-subtle bg-line-subtle md:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-surface px-5 py-4">
            <dt className="text-xs text-fg-subtle">{s.label}</dt>
            <dd className={cn('num mt-1 text-2xl font-semibold', s.tone)}>{fmt.number(s.value)}</dd>
          </div>
        ))}
      </dl>

      <div className="grid items-start gap-5 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-5 lg:col-span-2">
          <Panel id="brief-focus" title={t.briefing.focusTitle} icon={AlarmClock} bodyClassName="p-1.5">
            {focus.length === 0 ? (
              <EmptyState compact icon={AlarmClock} title={t.briefing.focusEmpty} />
            ) : (
              focus.map((task) => <TaskRow key={task.id} task={task} onOpen={editor.openEdit} />)
            )}
          </Panel>
          <Panel id="brief-next" title={t.briefing.nextTitle} icon={CalendarRange} bodyClassName="p-1.5">
            {next.length === 0 ? (
              <EmptyState compact icon={CalendarRange} title={t.briefing.nextEmpty} />
            ) : (
              next.map((task) => <TaskRow key={task.id} task={task} onOpen={editor.openEdit} />)
            )}
          </Panel>
          <Panel id="brief-knowledge" title={t.briefing.knowledgeTitle} icon={FileClock} bodyClassName="p-1.5">
            {updated.length === 0 ? (
              <EmptyState compact icon={FileClock} title={t.briefing.knowledgeEmpty} />
            ) : (
              <div className="divide-y divide-line-subtle">
                {updated.map((item) => (
                  <ItemRow key={item.id} item={item} onOpen={openItem} />
                ))}
              </div>
            )}
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <section
            aria-labelledby="brief-sample-title"
            className="rounded-xl border border-dashed border-line-strong bg-surface"
          >
            <header className="flex h-12 items-center gap-2 border-b border-line-subtle px-4">
              <NotebookPen size={15} strokeWidth={1.75} className="text-fg-subtle" aria-hidden />
              <h2 id="brief-sample-title" className="text-sm font-semibold text-fg">
                {t.briefing.sampleTitle}
              </h2>
              <Tooltip content={t.briefing.sampleHint}>
                <span tabIndex={0} className="ms-auto inline-flex rounded-full">
                  <Badge tone="info">{t.briefing.sampleBadge}</Badge>
                </span>
              </Tooltip>
            </header>
            <div className="flex flex-col gap-3 px-4 py-4">
              {sampleBriefingText[lang].map((para) => (
                <p key={para} className="text-base leading-relaxed text-fg-muted">
                  {para}
                </p>
              ))}
              <p className="text-xs text-fg-subtle">{t.briefing.sampleHint}</p>
            </div>
          </section>

          <Panel id="brief-projects" title={t.briefing.projectsTitle} icon={FolderKanban} bodyClassName="p-1.5">
            {active.length === 0 ? (
              <EmptyState compact icon={FolderKanban} title={t.briefing.projectsEmpty} />
            ) : (
              active.map((p) => {
                const s = projectStats(data, p.id)
                const nextTask = s.openTasks[0]
                return (
                  <Link key={p.id} to={`/projects/${p.id}`} className="block rounded-md px-3 py-2.5 transition-colors hover:bg-hover/60">
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-base font-medium text-fg" dir="auto">
                        {p.name}
                      </span>
                      <ProjectStatusBadge status={p.status} />
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-fg-muted" dir="auto">
                      {t.briefing.projectLine(fmt.number(s.openTasks.length), nextTask ? nextTask.title : t.briefing.projectNoNext)}
                    </span>
                  </Link>
                )
              })
            )}
          </Panel>
        </div>
      </div>
      <TaskEditorDialog state={editor.state} onClose={editor.close} />
    </Page>
  )
}
