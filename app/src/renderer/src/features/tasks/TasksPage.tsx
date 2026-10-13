import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { useSearchParams } from 'react-router'
import { CircleCheckBig, ListFilter, Plus, X } from 'lucide-react'
import { TASK_PRIORITIES, TASK_STATUSES, type Task } from '@shared/domain'
import { Button, EmptyState, Segmented, Select } from '@/design-system/components'
import { Page, PageHeader } from '@/features/shared/PageHeader'
import { TaskEditorDialog } from '@/features/shared/TaskEditorDialog'
import { TaskRow } from '@/features/shared/TaskRow'
import { useTaskEditor } from '@/features/shared/useTaskEditor'
import { cn } from '@/lib/cn'
import { useI18n, useNow } from '@/state/preferences'
import { useWorkspace } from '@/state/workspace'
import { filterTasks, groupTasks, sortProjects, type TaskGroup, type TaskQuery } from '@/state/selectors'

const DEFAULT_QUERY: TaskQuery = { status: 'all', priority: 'all', projectId: 'all' }

export default function TasksPage() {
  const { t, fmt } = useI18n()
  const { data } = useWorkspace()
  const now = useNow()
  const editor = useTaskEditor()
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState<TaskQuery>(DEFAULT_QUERY)

  // ?task=<id> (from search, briefing or activity) opens that task's editor.
  const taskParam = params.get('task')
  useEffect(() => {
    if (!taskParam) return
    const task = data.tasks.find((x) => x.id === taskParam)
    if (task) editor.openEdit(task)
    const next = new URLSearchParams(params)
    next.delete('task')
    setParams(next, { replace: true })
  }, [taskParam]) // eslint-disable-line react-hooks/exhaustive-deps

  const tasks = useMemo(() => filterTasks(data.tasks, query), [data.tasks, query])
  const groups = groupTasks(tasks, now)
  const filtered = query.status !== 'all' || query.priority !== 'all' || query.projectId !== 'all'
  const openCount = data.tasks.filter((x) => x.status !== 'done').length
  const groupLabel: Record<TaskGroup, string> = {
    overdue: t.tasks.groupOverdue,
    today: t.tasks.groupToday,
    upcoming: t.tasks.groupUpcoming,
    noDate: t.tasks.groupNoDate,
    done: t.tasks.groupDone
  }
  const set = <K extends keyof TaskQuery>(key: K, value: TaskQuery[K]) => setQuery((q) => ({ ...q, [key]: value }))

  return (
    <Page>
      <PageHeader
        title={t.tasks.title}
        description={
          <>
            {t.tasks.description} <span className="num text-fg-subtle">· {t.tasks.countOpen(fmt.number(openCount))}</span>
          </>
        }
        actions={
          <Button variant="primary" icon={Plus} onClick={() => editor.openNew()}>
            {t.tasks.newTask}
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          label={t.tasks.filterStatus}
          size="sm"
          value={query.status}
          onChange={(v) => set('status', v)}
          options={[
            { value: 'all' as TaskQuery['status'], label: t.common.all },
            ...TASK_STATUSES.map((s) => ({ value: s as TaskQuery['status'], label: t.taskStatus[s] }))
          ]}
        />
        <Select
          aria-label={t.tasks.filterPriority}
          size="sm"
          value={query.priority}
          onChange={(v) => set('priority', v)}
          options={[
            { value: 'all' as TaskQuery['priority'], label: t.tasks.anyPriority },
            ...TASK_PRIORITIES.map((p) => ({ value: p as TaskQuery['priority'], label: t.priority[p] }))
          ]}
          className={cn('w-36', query.priority !== 'all' && 'border-accent-line')}
        />
        <Select
          aria-label={t.tasks.filterProject}
          size="sm"
          value={query.projectId}
          onChange={(v) => set('projectId', v)}
          options={[
            { value: 'all', label: t.tasks.anyProject },
            ...sortProjects(data.projects).map((p) => ({ value: p.id, label: p.name }))
          ]}
          className={cn('w-56', query.projectId !== 'all' && 'border-accent-line')}
        />
        {filtered && (
          <Button variant="ghost" size="sm" icon={X} onClick={() => setQuery(DEFAULT_QUERY)}>
            {t.common.clearFilters}
          </Button>
        )}
      </div>

      {tasks.length === 0 ? (
        <div className="rounded-xl border border-line-subtle bg-surface">
          {filtered ? (
            <EmptyState
              icon={ListFilter}
              title={t.tasks.emptyTitle}
              description={t.tasks.emptyHint}
              action={<Button onClick={() => setQuery(DEFAULT_QUERY)}>{t.common.clearFilters}</Button>}
            />
          ) : (
            <EmptyState
              icon={CircleCheckBig}
              title={t.tasks.allDoneTitle}
              description={t.tasks.allDoneHint}
              action={
                <Button icon={Plus} onClick={() => editor.openNew()}>
                  {t.tasks.newTask}
                </Button>
              }
            />
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map(({ group, tasks: list }) => (
            <section key={group} aria-labelledby={`tasks-${group}`} className="rounded-xl border border-line-subtle bg-surface">
              <header className="flex h-11 items-center gap-2 border-b border-line-subtle px-4">
                <h2
                  id={`tasks-${group}`}
                  className={cn('text-sm font-semibold', group === 'overdue' ? 'text-danger' : group === 'today' ? 'text-warning' : 'text-fg')}
                >
                  {groupLabel[group]}
                </h2>
                <span className="num text-xs text-fg-subtle">{fmt.number(list.length)}</span>
              </header>
              <div className="p-1.5">
                <AnimatePresence initial={false}>
                  {list.map((task: Task) => (
                    <TaskRow key={task.id} task={task} onOpen={editor.openEdit} />
                  ))}
                </AnimatePresence>
              </div>
            </section>
          ))}
        </div>
      )}
      <TaskEditorDialog state={editor.state} onClose={editor.close} />
    </Page>
  )
}
