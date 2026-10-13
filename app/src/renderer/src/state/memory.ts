/**
 * Pure queries for project memory: project overview numbers, related-content
 * lists and tag usage. Everything is derived from the workspace cache, which
 * itself only holds what the database committed, so no figure comes from a
 * separate array.
 */
import type { Decision, DecisionStatus, Id, ItemKind, KnowledgeItem, Project, SourceRef, Tag, Task } from '@shared/domain'
import { DECISION_STATUSES } from '@shared/domain'
import type { WorkspaceData } from '@/mocks/seed'
import { normalizeText } from '@/lib/text'
import { compareTasks } from './selectors'

const byUpdated = <T extends { updatedAt: string }>(a: T, b: T) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)

export const findDecision = (data: WorkspaceData, id: Id | null | undefined): Decision | undefined =>
  id ? data.decisions.find((d) => d.id === id) : undefined

export const decisionsInProject = (data: WorkspaceData, projectId: Id): Decision[] =>
  data.decisions.filter((d) => d.projectId === projectId).sort(byUpdated)

export const notesInProject = (data: WorkspaceData, projectId: Id): KnowledgeItem[] =>
  data.items.filter((i) => i.projectId === projectId).sort(byUpdated)

export interface RecentRecord {
  ref: SourceRef
  title: string
  kind: ItemKind | 'task' | 'decision'
  at: string
}

export interface ProjectOverview {
  noteCount: number
  openTaskCount: number
  doneTaskCount: number
  decisionCount: number
  decisionsByStatus: Record<DecisionStatus, number>
  recent: RecentRecord[]
  upcoming: Task[]
}

/** Overview numbers for one project, all counted from persisted records. */
export function projectOverview(data: WorkspaceData, project: Project, recentLimit = 6, upcomingLimit = 5): ProjectOverview {
  const notes = notesInProject(data, project.id)
  const tasks = data.tasks.filter((t) => t.projectId === project.id)
  const decisions = decisionsInProject(data, project.id)
  const decisionsByStatus = Object.fromEntries(DECISION_STATUSES.map((s) => [s, 0])) as Record<DecisionStatus, number>
  for (const d of decisions) decisionsByStatus[d.status] += 1
  const recent: RecentRecord[] = [
    ...notes.map((i) => ({ ref: { type: 'item' as const, id: i.id }, title: i.title, kind: i.kind, at: i.updatedAt })),
    ...tasks.map((t) => ({ ref: { type: 'task' as const, id: t.id }, title: t.title, kind: 'task' as const, at: t.updatedAt })),
    ...decisions.map((d) => ({ ref: { type: 'decision' as const, id: d.id }, title: d.title, kind: 'decision' as const, at: d.updatedAt }))
  ]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, recentLimit)
  return {
    noteCount: notes.length,
    openTaskCount: tasks.filter((t) => t.status !== 'done').length,
    doneTaskCount: tasks.filter((t) => t.status === 'done').length,
    decisionCount: decisions.length,
    decisionsByStatus,
    recent,
    upcoming: tasks.filter((t) => t.status !== 'done' && t.dueDate !== null).sort(compareTasks).slice(0, upcomingLimit)
  }
}

// ---------- related content ----------

export interface RelatedGroup {
  key: 'project' | 'notes' | 'tasks' | 'decisions' | 'replaces' | 'supersededBy'
  /** Records in the group, already resolved from the cache. */
  entries: RelatedEntry[]
}

export type RelatedEntry =
  | { type: 'project'; record: Project }
  | { type: 'item'; record: KnowledgeItem }
  | { type: 'task'; record: Task }
  | { type: 'decision'; record: Decision }

const decisionsLinking = (data: WorkspaceData, field: 'noteIds' | 'taskIds', id: Id) =>
  data.decisions.filter((d) => d[field].includes(id)).sort(byUpdated)

/** What a note points to and what points back at it. */
export function relatedForItem(data: WorkspaceData, item: KnowledgeItem): RelatedGroup[] {
  const project = data.projects.find((p) => p.id === item.projectId)
  return [
    { key: 'project', entries: project ? [{ type: 'project', record: project }] : [] },
    {
      key: 'decisions',
      entries: decisionsLinking(data, 'noteIds', item.id).map((record) => ({ type: 'decision' as const, record }))
    }
  ]
}

export function relatedForTask(data: WorkspaceData, task: Task): RelatedGroup[] {
  const project = data.projects.find((p) => p.id === task.projectId)
  return [
    { key: 'project', entries: project ? [{ type: 'project', record: project }] : [] },
    {
      key: 'decisions',
      entries: decisionsLinking(data, 'taskIds', task.id).map((record) => ({ type: 'decision' as const, record }))
    }
  ]
}

export function relatedForDecision(data: WorkspaceData, decision: Decision): RelatedGroup[] {
  const project = data.projects.find((p) => p.id === decision.projectId)
  const notes = decision.noteIds
    .map((id) => data.items.find((i) => i.id === id))
    .filter((i): i is KnowledgeItem => Boolean(i))
  const tasks = decision.taskIds.map((id) => data.tasks.find((t) => t.id === id)).filter((t): t is Task => Boolean(t))
  const supersededBy = findDecision(data, decision.supersededById)
  const replaces = data.decisions.filter((d) => d.supersededById === decision.id).sort(byUpdated)
  return [
    { key: 'project', entries: project ? [{ type: 'project', record: project }] : [] },
    { key: 'notes', entries: notes.map((record) => ({ type: 'item' as const, record })) },
    { key: 'tasks', entries: tasks.map((record) => ({ type: 'task' as const, record })) },
    { key: 'supersededBy', entries: supersededBy ? [{ type: 'decision', record: supersededBy }] : [] },
    { key: 'replaces', entries: replaces.map((record) => ({ type: 'decision' as const, record })) }
  ]
}

// ---------- decisions list ----------

export interface DecisionQuery {
  text: string
  status: DecisionStatus | 'all'
  projectId: Id | 'all'
  tagId?: Id | undefined
}

export function filterDecisions(data: WorkspaceData, q: DecisionQuery): Decision[] {
  const words = normalizeText(q.text).split(' ').filter(Boolean)
  const tags = new Map(data.tags.map((t) => [t.id, t.label]))
  return data.decisions
    .filter((d) => {
      if (q.status !== 'all' && d.status !== q.status) return false
      if (q.projectId !== 'all' && d.projectId !== q.projectId) return false
      if (q.tagId && !d.tagIds.includes(q.tagId)) return false
      if (words.length === 0) return true
      const hay = normalizeText(
        [d.title, d.context, d.decision, d.rationale, d.alternatives, d.consequences, ...d.tagIds.map((id) => tags.get(id) ?? '')].join(' ')
      )
      return words.every((w) => hay.includes(w))
    })
    .sort(byUpdated)
}

// ---------- tags ----------

export interface TagUsage {
  tag: Tag
  notes: number
  decisions: number
}

/** Every tag with how many notes and decisions use it (unused tags included). */
export function tagUsage(data: WorkspaceData): TagUsage[] {
  const notes = new Map<Id, number>()
  const decisions = new Map<Id, number>()
  for (const i of data.items) for (const id of i.tagIds) notes.set(id, (notes.get(id) ?? 0) + 1)
  for (const d of data.decisions) for (const id of d.tagIds) decisions.set(id, (decisions.get(id) ?? 0) + 1)
  return data.tags
    .map((tag) => ({ tag, notes: notes.get(tag.id) ?? 0, decisions: decisions.get(tag.id) ?? 0 }))
    .sort((a, b) => b.notes + b.decisions - (a.notes + a.decisions) || a.tag.label.localeCompare(b.tag.label))
}

export function recordsWithTag(data: WorkspaceData, tagId: Id): { items: KnowledgeItem[]; decisions: Decision[] } {
  return {
    items: data.items.filter((i) => i.tagIds.includes(tagId)).sort(byUpdated),
    decisions: data.decisions.filter((d) => d.tagIds.includes(tagId)).sort(byUpdated)
  }
}
