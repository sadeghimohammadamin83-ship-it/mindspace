import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { FileText, FolderKanban, Plus } from 'lucide-react'
import { PROJECT_STATUSES, type Project, type ProjectStatus } from '@shared/domain'
import { Button, EmptyState, ProgressBar, Segmented } from '@/design-system/components'
import { OriginMark, ProjectStatusBadge } from '@/features/shared/meta'
import { Page, PageHeader } from '@/features/shared/PageHeader'
import { useI18n } from '@/state/preferences'
import { useWorkspace } from '@/state/workspace'
import { projectStats, sortProjects } from '@/state/selectors'
import { ProjectCreateDialog } from './ProjectCreateDialog'

type StatusFilter = ProjectStatus | 'all'

function ProjectCard({ project }: { project: Project }) {
  const { t, fmt } = useI18n()
  const { data } = useWorkspace()
  const s = projectStats(data, project.id)
  return (
    <Link
      to={`/projects/${project.id}`}
      className="group flex min-h-52 flex-col rounded-xl border border-line-subtle bg-surface p-5 transition-colors hover:border-line hover:bg-raised"
    >
      <div className="flex items-center gap-2">
        <ProjectStatusBadge status={project.status} />
        <OriginMark origin={project.origin} />
        <span className="ms-auto text-xs text-fg-subtle">{t.projects.lastUpdated(fmt.relative(project.updatedAt))}</span>
      </div>
      <h2 className="mt-3.5 line-clamp-2 text-md font-semibold text-fg group-hover:text-fg" dir="auto">
        {project.name}
      </h2>
      <p className="mt-1.5 line-clamp-2 text-sm text-fg-muted" dir="auto">
        {project.description}
      </p>
      <div className="mt-auto pt-5">
        <div className="mb-2 flex items-center justify-between text-xs text-fg-subtle">
          <span className="inline-flex items-center gap-1.5">
            <FileText size={12} aria-hidden />
            {t.projects.notesCount(fmt.number(s.itemCount))}
          </span>
          <span className="num">
            {s.taskTotal ? t.projects.tasksProgress(fmt.number(s.taskDone), fmt.number(s.taskTotal)) : t.projects.noTasks}
          </span>
        </div>
        <ProgressBar value={s.taskDone} max={s.taskTotal} label={`${t.projects.progress}: ${project.name}`} />
      </div>
    </Link>
  )
}

export default function ProjectsPage() {
  const { t, fmt } = useI18n()
  const { data } = useWorkspace()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [creating, setCreating] = useState(false)

  const projects = sortProjects(data.projects).filter((p) => filter === 'all' || p.status === filter)
  const count = (s: StatusFilter) => (s === 'all' ? data.projects.length : data.projects.filter((p) => p.status === s).length)

  return (
    <Page>
      <PageHeader
        title={t.projects.title}
        description={t.projects.description}
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            {t.projects.newProject}
          </Button>
        }
      />
      <Segmented
        label={t.common.status}
        value={filter}
        onChange={setFilter}
        size="sm"
        className="mb-5"
        options={[
          { value: 'all' as StatusFilter, label: `${t.common.all} · ${fmt.number(count('all'))}` },
          ...PROJECT_STATUSES.map((s) => ({ value: s as StatusFilter, label: `${t.projectStatus[s]} · ${fmt.number(count(s))}` }))
        ]}
      />
      {projects.length === 0 ? (
        <div className="rounded-xl border border-line-subtle bg-surface">
          <EmptyState
            icon={FolderKanban}
            title={t.projects.emptyTitle}
            description={t.projects.emptyHint}
            action={
              <Button icon={Plus} onClick={() => setCreating(true)}>
                {t.projects.newProject}
              </Button>
            }
          />
        </div>
      ) : (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}
      <ProjectCreateDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(p) => {
          setCreating(false)
          navigate(`/projects/${p.id}`)
        }}
      />
    </Page>
  )
}
