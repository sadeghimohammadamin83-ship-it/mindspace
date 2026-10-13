import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { ArrowUpRight, CalendarCheck2, FilePlus2, FolderKanban, History, Inbox, Clock3, SlidersHorizontal, Sunrise } from 'lucide-react'
import type { KnowledgeItem } from '@shared/domain'
import { Badge, Button, buttonClass, EmptyState, Panel, ProgressBar, useToast } from '@/design-system/components'
import { useCaptureDialog } from '@/app/CaptureDialog'
import { ActivityLine } from '@/app/ActivityPopover'
import { useSaveError } from '@/features/shared/useSaveError'
import { refPath } from '@/app/navigation'
import { ItemRow } from '@/features/shared/ItemRow'
import { Page } from '@/features/shared/PageHeader'
import { TaskEditorDialog } from '@/features/shared/TaskEditorDialog'
import { TaskRow } from '@/features/shared/TaskRow'
import { useTaskEditor } from '@/features/shared/useTaskEditor'
import { cn } from '@/lib/cn'
import { useI18n, useNow } from '@/state/preferences'
import { useWorkspace } from '@/state/workspace'
import { projectStats, recentItems, sortProjects, upcomingTasks } from '@/state/selectors'

function greetingFor(hour: number): 'morning' | 'afternoon' | 'evening' | 'night' {
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 17) return 'afternoon'
  if (hour >= 17 && hour < 22) return 'evening'
  return 'night'
}

function InlineCapture() {
  const { t } = useI18n()
  const { commands } = useWorkspace()
  const openCapture = useCaptureDialog()
  const toast = useToast()
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const saveError = useSaveError()

  const save = async (e: FormEvent) => {
    e.preventDefault()
    const value = text.trim()
    if (!value || saving) return
    // Long thoughts keep their full text as the body and a shortened title.
    const title = value.length > 80 ? `${value.slice(0, 77).trimEnd()}…` : value
    setSaving(true)
    let item
    try {
      item = await commands.captureItem({ kind: 'note', title, body: value.length > 80 ? value : '', url: '', tagLabels: [], projectId: null })
    } catch (err) {
      saveError(err)
      return
    } finally {
      setSaving(false)
    }
    setText('')
    toast({
      title: t.dashboard.quickCaptureSaved,
      description: item.title,
      action: { label: t.common.view, onClick: () => navigate(refPath({ type: 'item', id: item.id })) }
    })
  }

  return (
    <form onSubmit={save} className="flex items-center gap-2 rounded-xl border border-line-subtle bg-surface p-2 ps-4 transition-colors focus-within:border-line-strong">
      <FilePlus2 size={17} strokeWidth={1.75} className="shrink-0 text-accent-text" aria-hidden />
      <label htmlFor="dash-capture" className="sr-only">
        {t.dashboard.quickCaptureLabel}
      </label>
      <input
        id="dash-capture"
        dir="auto"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t.dashboard.quickCapturePlaceholder}
        className="h-9 min-w-0 flex-1 bg-transparent text-md text-fg placeholder:text-fg-subtle focus-visible:outline-none"
      />
      <Button variant="ghost" size="sm" icon={SlidersHorizontal} onClick={() => openCapture({ kind: 'note' })}>
        <span className="hidden md:inline">{t.dashboard.quickCaptureMore}</span>
      </Button>
      <Button variant="primary" size="sm" type="submit" disabled={!text.trim()} loading={saving}>
        {t.dashboard.quickCaptureSave}
      </Button>
    </form>
  )
}

export default function DashboardPage() {
  const { t, fmt } = useI18n()
  const { data } = useWorkspace()
  const navigate = useNavigate()
  const now = useNow()
  const editor = useTaskEditor()

  const upcoming = upcomingTasks(data.tasks, now, 7)
  const active = sortProjects(data.projects).filter((p) => p.status === 'active')
  const recentCaptures = recentItems(data.items, 'createdAt', 4)
  const captureIds = new Set(recentCaptures.map((i) => i.id))
  const recentlyUpdated = recentItems(
    data.items.filter((i) => !captureIds.has(i.id)),
    'updatedAt',
    4
  )
  const dueToday = upcoming.filter((task) => task.dueDate && fmt.due(task.dueDate).days <= 0)
  const openItem = (item: KnowledgeItem) => navigate(refPath({ type: 'item', id: item.id }))

  return (
    <Page>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-fg-subtle">{fmt.weekdayDate(now)}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-fg">{t.greeting[greetingFor(now.getHours())]}</h1>
          <p className="mt-1 text-base text-fg-muted">
            {t.dashboard.summary(fmt.number(upcoming.length), fmt.number(active.length))}
          </p>
        </div>
      </header>

      <div className="grid items-start gap-5 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-5 lg:col-span-2">
          <InlineCapture />

          <Panel
            id="dash-upcoming"
            title={t.dashboard.upcomingTasks}
            icon={CalendarCheck2}
            badge={dueToday.length > 0 ? <Badge tone="warning">{t.briefing.stats.dueToday}: {fmt.number(dueToday.length)}</Badge> : null}
            action={
              <Link to="/tasks" className={buttonClass('ghost', 'sm')}>
                {t.common.viewAll}
              </Link>
            }
            bodyClassName="p-1.5"
          >
            {upcoming.length === 0 ? (
              <EmptyState compact icon={CalendarCheck2} title={t.dashboard.upcomingEmpty} />
            ) : (
              upcoming.slice(0, 6).map((task) => <TaskRow key={task.id} task={task} onOpen={editor.openEdit} />)
            )}
          </Panel>

          <div className="grid gap-5 md:grid-cols-2">
            <Panel id="dash-captures" title={t.dashboard.recentCaptures} icon={Inbox} bodyClassName="p-1.5">
              {recentCaptures.length === 0 ? (
                <EmptyState compact icon={Inbox} title={t.dashboard.recentCapturesEmpty} />
              ) : (
                recentCaptures.map((item) => (
                  <ItemRow key={item.id} item={item} onOpen={openItem} timestamp="createdAt" dense />
                ))
              )}
            </Panel>
            <Panel
              id="dash-updated"
              title={t.dashboard.recentlyUpdated}
              icon={Clock3}
              action={
                <Link to="/library" className={buttonClass('ghost', 'sm')}>
                  {t.common.viewAll}
                </Link>
              }
              bodyClassName="p-1.5"
            >
              {recentlyUpdated.map((item) => (
                <ItemRow key={item.id} item={item} onOpen={openItem} dense />
              ))}
            </Panel>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <BriefingPreview />

          <Panel
            id="dash-projects"
            title={t.dashboard.activeProjects}
            icon={FolderKanban}
            action={
              <Link to="/projects" className={buttonClass('ghost', 'sm')}>
                {t.common.viewAll}
              </Link>
            }
            bodyClassName="p-1.5"
          >
            {active.length === 0 ? (
              <EmptyState compact icon={FolderKanban} title={t.dashboard.activeProjectsEmpty} />
            ) : (
              active.slice(0, 4).map((p) => {
                const s = projectStats(data, p.id)
                return (
                  <Link key={p.id} to={`/projects/${p.id}`} className="block rounded-md px-3 py-2.5 transition-colors hover:bg-hover/60">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-base font-medium text-fg" dir="auto">
                        {p.name}
                      </span>
                      <span className="num shrink-0 text-xs text-fg-subtle">
                        {t.dashboard.tasksDone(fmt.number(s.taskDone), fmt.number(s.taskTotal))}
                      </span>
                    </div>
                    <div className="mt-2">
                      <ProgressBar value={s.taskDone} max={s.taskTotal} label={`${t.projects.progress}: ${p.name}`} />
                    </div>
                  </Link>
                )
              })
            )}
          </Panel>

          <Panel id="dash-activity" title={t.dashboard.activity} icon={History} bodyClassName="p-1.5">
            {data.activity.slice(0, 4).map((e) => (
              <ActivityLine key={e.id} event={e} onSelect={(ev) => navigate(refPath(ev.ref))} />
            ))}
          </Panel>
        </div>
      </div>

      <TaskEditorDialog state={editor.state} onClose={editor.close} />
    </Page>
  )
}

function BriefingPreview() {
  const { t, fmt } = useI18n()
  const { data } = useWorkspace()
  const now = useNow()
  const due = upcomingTasks(data.tasks, now, 0)
  const overdue = due.filter((task) => task.dueDate && fmt.due(task.dueDate).days < 0).length
  const today = due.length - overdue
  const week = upcomingTasks(data.tasks, now, 7).length
  const stats = [
    { label: t.briefing.stats.dueToday, value: today, tone: today ? 'text-warning' : 'text-fg' },
    { label: t.briefing.stats.overdue, value: overdue, tone: overdue ? 'text-danger' : 'text-fg' },
    { label: t.briefing.stats.thisWeek, value: week, tone: 'text-fg' }
  ]
  return (
    <section aria-labelledby="dash-brief-title" className="rounded-xl border border-accent-line/60 bg-surface">
      <header className="flex h-12 items-center gap-2 border-b border-line-subtle px-4">
        <Sunrise size={15} strokeWidth={1.75} className="text-accent-text" aria-hidden />
        <h2 id="dash-brief-title" className="text-sm font-semibold text-fg">
          {t.dashboard.briefingPreview}
        </h2>
        <Link to="/briefing" className={cn(buttonClass('ghost', 'sm'), 'ms-auto')}>
          {t.dashboard.openBriefing}
          <ArrowUpRight size={13} aria-hidden className="flip-rtl" />
        </Link>
      </header>
      <dl className="grid grid-cols-3 divide-x divide-line-subtle rtl:divide-x-reverse">
        {stats.map((s) => (
          <div key={s.label} className="px-4 py-3.5">
            <dt className="text-xs text-fg-subtle">{s.label}</dt>
            <dd className={cn('num mt-1 text-xl font-semibold', s.tone)}>{fmt.number(s.value)}</dd>
          </div>
        ))}
      </dl>
      <p className="border-t border-line-subtle px-4 py-3 text-xs text-fg-subtle">{t.briefing.computedHint}</p>
    </section>
  )
}
