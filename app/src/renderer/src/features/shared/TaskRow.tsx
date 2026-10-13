import { motion } from 'motion/react'
import { FolderKanban, MoreHorizontal } from 'lucide-react'
import { Link } from 'react-router'
import { TASK_STATUSES, type Task } from '@shared/domain'
import { IconButton, Menu, MenuLabel, MenuRadioGroup, TaskCheck, useToast } from '@/design-system/components'
import { TRANSITION } from '@/design-system/motion'
import { cn } from '@/lib/cn'
import { useI18n } from '@/state/preferences'
import { useWorkspace } from '@/state/workspace'
import { findProject } from '@/state/selectors'
import { DueLabel } from './DueLabel'
import { OriginMark, PriorityBadge } from './meta'
import { useSaveError } from './useSaveError'

/**
 * One task line: completion toggle, title (opens the editor), metadata and a
 * status menu. Used on Tasks, Dashboard, Projects and Briefing.
 */
export function TaskRow({
  task,
  onOpen,
  showProject = true,
  dense
}: {
  task: Task
  onOpen: (task: Task) => void
  showProject?: boolean
  dense?: boolean
}) {
  const { t } = useI18n()
  const { data, commands } = useWorkspace()
  const toast = useToast()
  const saveError = useSaveError()
  const project = showProject ? findProject(data, task.projectId) : undefined
  const done = task.status === 'done'

  const setStatus = async (status: Task['status']) => {
    const previous = task.status
    try {
      await commands.setTaskStatus(task.id, status)
    } catch (err) {
      saveError(err)
      return
    }
    toast({
      title: status === 'done' ? t.tasks.completed : previous === 'done' ? t.tasks.reopened : t.tasks.statusChanged(t.taskStatus[status]),
      description: task.title,
      tone: 'success',
      action: { label: t.tasks.undo, onClick: () => void commands.setTaskStatus(task.id, previous).catch(saveError) }
    })
  }

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: TRANSITION.fast }}
      transition={{ opacity: TRANSITION.base, layout: TRANSITION.layout }}
      className={cn(
        'group flex items-center gap-3 rounded-md px-3 transition-colors hover:bg-hover/60',
        dense ? 'min-h-10 py-1.5' : 'min-h-12 py-2'
      )}
    >
      <TaskCheck
        checked={done}
        onChange={(v) => setStatus(v ? 'done' : 'todo')}
        label={done ? t.tasks.markOpen(task.title) : t.tasks.markDone(task.title)}
      />
      <button
        type="button"
        onClick={() => onOpen(task)}
        aria-label={t.tasks.editTask(task.title)}
        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-sm text-start"
      >
        <span
          dir="auto"
          className={cn('w-full truncate text-base', done ? 'text-fg-subtle line-through decoration-fg-disabled' : 'text-fg')}
        >
          {task.title}
        </span>
        {!dense && (project || task.status === 'in_progress') && (
          <span className="flex max-w-full items-center gap-2 text-xs text-fg-subtle">
            {task.status === 'in_progress' && <span className="text-info">{t.taskStatus.in_progress}</span>}
            {project && (
              <span className="truncate" dir="auto">
                {project.name}
              </span>
            )}
          </span>
        )}
      </button>
      <div className="flex shrink-0 items-center gap-2.5">
        <OriginMark origin={task.origin} />
        {!done && <PriorityBadge priority={task.priority} />}
        <DueLabel date={task.dueDate} done={done} compact />
        <Menu
          label={t.tasks.changeStatus}
          trigger={
            <IconButton
              icon={MoreHorizontal}
              label={t.tasks.changeStatus}
              size="sm"
              className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
            />
          }
        >
          <MenuLabel>{t.tasks.changeStatus}</MenuLabel>
          <MenuRadioGroup
            value={task.status}
            onChange={setStatus}
            options={TASK_STATUSES.map((s) => ({ value: s, label: t.taskStatus[s] }))}
          />
        </Menu>
      </div>
    </motion.div>
  )
}

export function ProjectLink({ id }: { id: string | null }) {
  const { data } = useWorkspace()
  const project = findProject(data, id)
  if (!project) return null
  return (
    <Link to={`/projects/${project.id}`} className="inline-flex max-w-full min-w-0 items-center gap-1 text-xs text-fg-muted hover:text-accent-text" dir="auto">
      <FolderKanban size={12} strokeWidth={1.75} aria-hidden className="shrink-0" />
      <span className="truncate">{project.name}</span>
    </Link>
  )
}
