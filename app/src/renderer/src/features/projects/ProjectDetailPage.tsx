import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { AnimatePresence } from 'motion/react'
import { ArrowLeft, FileText, FolderX, Gavel, History, LayoutList, Link2, ListChecks, PenLine, Plus, Unlink } from 'lucide-react'
import { DECISION_STATUSES, type Decision, type KnowledgeItem } from '@shared/domain'
import { Button, buttonClass, EmptyState, IconButton, Panel, ProgressBar, Segmented, Tabs, TabPanel, useToast } from '@/design-system/components'
import { useCaptureDialog } from '@/app/CaptureDialog'
import { ActivityTimeline } from '@/features/memory/ActivityTimeline'
import { DecisionDetail } from '@/features/memory/DecisionDetail'
import { DecisionEditorDialog, type DecisionEditorState } from '@/features/memory/DecisionEditorDialog'
import { DecisionRow } from '@/features/memory/DecisionRow'
import { DecisionStatusBadge, DecisionStatusGuide } from '@/features/memory/DecisionStatus'
import { LinkPickerDialog } from '@/features/memory/LinkPickerDialog'
import { ItemDetail } from '@/features/library/ItemDetail'
import { ItemRow } from '@/features/shared/ItemRow'
import { KindIcon, OriginMark, ProjectStatusBadge } from '@/features/shared/meta'
import { Page } from '@/features/shared/PageHeader'
import { TaskEditorDialog } from '@/features/shared/TaskEditorDialog'
import { TaskRow } from '@/features/shared/TaskRow'
import { useSaveError } from '@/features/shared/useSaveError'
import { useTaskEditor } from '@/features/shared/useTaskEditor'
import { refPath } from '@/app/navigation'
import { useI18n } from '@/state/preferences'
import { useWorkspace } from '@/state/workspace'
import { compareTasks, findProject } from '@/state/selectors'
import { decisionsInProject, notesInProject, projectOverview } from '@/state/memory'

const TABS = ['overview', 'notes', 'tasks', 'decisions', 'activity'] as const
type TabKey = (typeof TABS)[number]
type TaskView = 'open' | 'all' | 'done'

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-24">
      <dd className="num text-2xl font-semibold text-fg">{value}</dd>
      <dt className="text-xs text-fg-subtle">{label}</dt>
    </div>
  )
}

/**
 * The project workspace: one place for a project's overview, notes, tasks,
 * decisions and history. Every list and number is read from the persisted
 * records in the workspace cache; tabs and open records live in the URL.
 */
export default function ProjectDetailPage() {
  const { t, fmt } = useI18n()
  const { data, commands } = useWorkspace()
  const { projectId } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const saveError = useSaveError()
  const openCapture = useCaptureDialog()
  const editor = useTaskEditor()
  const [params, setParams] = useSearchParams()
  const [decisionEditor, setDecisionEditor] = useState<DecisionEditorState>({ open: false })
  const [notePicker, setNotePicker] = useState(false)
  const [taskView, setTaskView] = useState<TaskView>('open')
  const project = findProject(data, projectId)

  const tabParam = params.get('tab')
  const tab: TabKey = (TABS as readonly string[]).includes(tabParam ?? '') ? (tabParam as TabKey) : 'overview'
  const update = (mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params)
    mutate(next)
    setParams(next, { replace: true })
  }

  const back = (
    <Link to="/projects" className={buttonClass('ghost', 'sm', '-ms-2.5 mb-3')}>
      <ArrowLeft size={14} aria-hidden className="flip-rtl" />
      {t.projects.detailBack}
    </Link>
  )

  if (!project) {
    return (
      <Page>
        {back}
        <EmptyState icon={FolderX} title={t.projects.notFoundTitle} description={t.projects.notFoundHint} />
      </Page>
    )
  }

  const overview = projectOverview(data, project)
  const notes = notesInProject(data, project.id)
  const decisions = decisionsInProject(data, project.id)
  const tasks = data.tasks.filter((x) => x.projectId === project.id)
  const open = tasks.filter((x) => x.status !== 'done').sort(compareTasks)
  const done = tasks.filter((x) => x.status === 'done')
  const shownTasks = taskView === 'open' ? open : taskView === 'done' ? done : [...open, ...done]
  const total = tasks.length

  const openNote = (item: KnowledgeItem) => update((p) => p.set('item', item.id))
  const openDecision = (d: Decision) => update((p) => p.set('decision', d.id))
  const goTab = (key: TabKey) =>
    update((p) => {
      p.set('tab', key)
    })

  const unlinkNote = async (item: KnowledgeItem) => {
    try {
      await commands.updateItem(item.id, { projectId: null })
      toast({ title: t.memory.noteUnlinked, description: item.title, tone: 'info' })
    } catch (err) {
      saveError(err)
    }
  }

  const linkOptions = data.items
    .filter((i) => i.projectId !== project.id)
    .map((i) => {
      const current = findProject(data, i.projectId)
      return { id: i.id, title: i.title, subtitle: `${t.kinds[i.kind]} · ${current ? t.memory.currentlyIn(current.name) : t.memory.notAssigned}` }
    })

  return (
    <Page>
      {back}
      <header className="mb-5 flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0 max-w-3xl">
          <div className="mb-2 flex items-center gap-2">
            <ProjectStatusBadge status={project.status} />
            <OriginMark origin={project.origin} />
            <span className="text-xs text-fg-subtle">{t.projects.lastUpdated(fmt.relative(project.updatedAt))}</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg" dir="auto">
            {project.name}
          </h1>
          {project.description && (
            <p className="mt-1.5 text-base text-fg-muted" dir="auto">
              {project.description}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button icon={PenLine} onClick={() => openCapture({ kind: 'note', projectId: project.id })}>
            {t.memory.newNote}
          </Button>
          <Button icon={Gavel} onClick={() => setDecisionEditor({ open: true, defaults: { projectId: project.id } })}>
            {t.memory.newDecision}
          </Button>
          <Button variant="primary" icon={Plus} onClick={() => editor.openNew({ projectId: project.id })}>
            {t.projects.addTask}
          </Button>
        </div>
      </header>

      <Tabs
        value={tab}
        onValueChange={goTab}
        label={t.memory.sectionsLabel}
        tabs={[
          { value: 'overview', label: t.memory.tabOverview, icon: LayoutList },
          { value: 'notes', label: t.memory.tabNotes, icon: FileText, count: fmt.number(overview.noteCount) },
          { value: 'tasks', label: t.memory.tabTasks, icon: ListChecks, count: fmt.number(total) },
          { value: 'decisions', label: t.memory.tabDecisions, icon: Gavel, count: fmt.number(overview.decisionCount) },
          { value: 'activity', label: t.memory.tabActivity, icon: History }
        ]}
      >
        <TabPanel value="overview">
          <div className="mb-5 flex flex-wrap items-center gap-x-10 gap-y-4 rounded-xl border border-line-subtle bg-surface px-5 py-4">
            <dl className="flex flex-wrap gap-x-10 gap-y-3">
              <Stat label={t.memory.statNotes} value={fmt.number(overview.noteCount)} />
              <Stat label={t.memory.statOpenTasks} value={fmt.number(overview.openTaskCount)} />
              <Stat label={t.memory.statDoneTasks} value={fmt.number(overview.doneTaskCount)} />
              <Stat label={t.memory.statDecisions} value={fmt.number(overview.decisionCount)} />
            </dl>
            <div className="min-w-56 flex-1">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-fg-muted">{t.projects.progress}</span>
                <span className="num text-fg">{total ? fmt.percent(overview.doneTaskCount / total) : '—'}</span>
              </div>
              <ProgressBar value={overview.doneTaskCount} max={total} label={t.projects.progress} />
            </div>
          </div>

          <div className="grid items-start gap-5 lg:grid-cols-2">
            <Panel id="overview-about" title={t.memory.aboutTitle} icon={LayoutList} bodyClassName="p-4">
              <p className="mb-3 text-md leading-relaxed whitespace-pre-wrap text-fg" dir="auto">
                {project.description || <span className="text-fg-muted">{t.memory.noDescription}</span>}
              </p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                <dt className="text-fg-subtle">{t.common.status}</dt>
                <dd>
                  <ProjectStatusBadge status={project.status} />
                </dd>
                <dt className="text-fg-subtle">{t.memory.createdLabel}</dt>
                <dd className="text-fg-muted">
                  <time dateTime={project.createdAt}>{fmt.date(project.createdAt, 'long')}</time>
                </dd>
                <dt className="text-fg-subtle">{t.memory.updatedLabel}</dt>
                <dd className="text-fg-muted">
                  <time dateTime={project.updatedAt}>{fmt.relative(project.updatedAt)}</time>
                </dd>
              </dl>
            </Panel>

            <Panel id="overview-upcoming" title={t.memory.upcomingTitle} icon={ListChecks} bodyClassName="p-1.5">
              {overview.upcoming.length === 0 ? (
                <EmptyState compact icon={ListChecks} title={t.memory.upcomingEmpty} />
              ) : (
                overview.upcoming.map((task) => <TaskRow key={task.id} task={task} onOpen={editor.openEdit} showProject={false} dense />)
              )}
            </Panel>

            <Panel id="overview-recent" title={t.memory.recentTitle} icon={History} bodyClassName="p-1.5">
              {overview.recent.length === 0 ? (
                <EmptyState compact icon={History} title={t.memory.recentEmpty} />
              ) : (
                <ul className="divide-y divide-line-subtle">
                  {overview.recent.map((r) => (
                    <li key={`${r.ref.type}:${r.ref.id}`} className="flex items-center gap-3 px-3 py-2">
                      <KindIcon kind={r.kind} size={14} />
                      <Link to={refPath(r.ref)} className="min-w-0 flex-1 truncate text-base text-fg hover:text-accent-text" dir="auto">
                        {r.title}
                      </Link>
                      <time dateTime={r.at} className="shrink-0 text-xs text-fg-subtle">
                        {fmt.relative(r.at)}
                      </time>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel id="overview-decisions" title={t.memory.decisionsSummaryTitle} icon={Gavel} bodyClassName="p-4">
              {overview.decisionCount === 0 ? (
                <p className="text-sm text-fg-muted">{t.memory.decisionsSummaryEmpty}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {DECISION_STATUSES.map((s) => (
                    <li key={s} className="flex items-center gap-3">
                      <DecisionStatusBadge status={s} />
                      <span className="num text-sm text-fg">{fmt.number(overview.decisionsByStatus[s])}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </TabPanel>

        <TabPanel value="notes">
          <Panel
            id="project-notes"
            title={t.memory.notesTitle}
            icon={FileText}
            bodyClassName="p-1.5"
            action={
              <>
                <Button size="sm" icon={Link2} onClick={() => setNotePicker(true)}>
                  {t.memory.linkExistingNote}
                </Button>
                <Button size="sm" icon={PenLine} onClick={() => openCapture({ kind: 'note', projectId: project.id })}>
                  {t.memory.newNote}
                </Button>
              </>
            }
          >
            {notes.length === 0 ? (
              <EmptyState
                compact
                icon={FileText}
                title={t.memory.notesEmpty}
                action={
                  <Button size="sm" icon={Link2} onClick={() => setNotePicker(true)}>
                    {t.memory.linkExistingNote}
                  </Button>
                }
              />
            ) : (
              <div className="divide-y divide-line-subtle">
                <AnimatePresence initial={false}>
                  {notes.map((item) => (
                    <div key={item.id} className="flex items-center gap-1">
                      <div className="min-w-0 flex-1">
                        <ItemRow item={item} onOpen={openNote} />
                      </div>
                      <IconButton icon={Unlink} size="sm" label={t.memory.removeFromProjectLabel(item.title)} onClick={() => void unlinkNote(item)} />
                    </div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </Panel>
        </TabPanel>

        <TabPanel value="tasks">
          <Panel
            id="project-tasks"
            title={t.projects.relatedTasks}
            icon={ListChecks}
            bodyClassName="p-1.5"
            action={
              <>
                <Segmented<TaskView>
                  size="sm"
                  label={t.tasks.filterStatus}
                  value={taskView}
                  onChange={setTaskView}
                  options={[
                    { value: 'open', label: `${t.memory.taskViewOpen} · ${fmt.number(open.length)}` },
                    { value: 'done', label: `${t.taskStatus.done} · ${fmt.number(done.length)}` },
                    { value: 'all', label: t.common.all }
                  ]}
                />
                <Button size="sm" variant="primary" icon={Plus} onClick={() => editor.openNew({ projectId: project.id })}>
                  {t.projects.addTask}
                </Button>
              </>
            }
          >
            {shownTasks.length === 0 ? (
              <EmptyState
                compact
                icon={ListChecks}
                title={t.projects.relatedTasksEmpty}
                action={
                  <Button size="sm" icon={Plus} onClick={() => editor.openNew({ projectId: project.id })}>
                    {t.projects.addTask}
                  </Button>
                }
              />
            ) : (
              shownTasks.map((task) => <TaskRow key={task.id} task={task} onOpen={editor.openEdit} showProject={false} />)
            )}
          </Panel>
        </TabPanel>

        <TabPanel value="decisions">
          <Panel
            id="project-decisions"
            title={t.memory.decisionsTitle}
            icon={Gavel}
            bodyClassName="p-1.5"
            action={
              <>
                <DecisionStatusGuide />
                <Button size="sm" variant="primary" icon={Plus} onClick={() => setDecisionEditor({ open: true, defaults: { projectId: project.id } })}>
                  {t.memory.newDecision}
                </Button>
              </>
            }
          >
            {decisions.length === 0 ? (
              <EmptyState
                compact
                icon={Gavel}
                title={t.memory.decisionsEmpty}
                description={t.memory.decisionsEmptyHint}
                action={
                  <Button size="sm" icon={Plus} onClick={() => setDecisionEditor({ open: true, defaults: { projectId: project.id } })}>
                    {t.memory.newDecision}
                  </Button>
                }
              />
            ) : (
              <div className="divide-y divide-line-subtle">
                {decisions.map((d) => (
                  <DecisionRow key={d.id} decision={d} onOpen={openDecision} showProject={false} />
                ))}
              </div>
            )}
          </Panel>
        </TabPanel>

        <TabPanel value="activity">
          <Panel id="project-activity" title={t.memory.activityTitle} icon={History} bodyClassName="p-4">
            <ActivityTimeline projectId={project.id} />
          </Panel>
        </TabPanel>
      </Tabs>

      <TaskEditorDialog state={editor.state} onClose={editor.close} />
      <DecisionEditorDialog
        state={decisionEditor}
        onClose={() => setDecisionEditor((s) => ({ ...s, open: false }))}
        onSaved={(id) =>
          update((p) => {
            p.set('tab', 'decisions')
            p.set('decision', id)
          })
        }
      />
      <DecisionDetail decisionId={params.get('decision')} onClose={() => update((p) => p.delete('decision'))} />
      <ItemDetail
        itemId={params.get('item')}
        onClose={() => update((p) => p.delete('item'))}
        onTagClick={(id) => navigate(`/library?tag=${encodeURIComponent(id)}`)}
      />
      <LinkPickerDialog
        open={notePicker}
        title={t.memory.notePickerTitle}
        description={t.memory.notePickerDescription}
        searchLabel={t.memory.notePickerSearch}
        emptyText={t.memory.notePickerEmpty}
        options={linkOptions}
        onPick={async (id) => {
          await commands.updateItem(id, { projectId: project.id })
          toast({ title: t.memory.noteLinked, tone: 'success' })
        }}
        onClose={() => setNotePicker(false)}
      />
    </Page>
  )
}
