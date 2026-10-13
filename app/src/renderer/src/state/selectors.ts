/**
 * Pure queries over the workspace. Pages call these instead of filtering data
 * themselves, so the same rules apply everywhere (and can move to the main
 * process in Phase 2).
 */
import type {
  Id,
  ItemKind,
  KnowledgeItem,
  Project,
  SourceRef,
  Tag,
  Task,
  TaskPriority,
  TaskStatus
} from '@shared/domain'
import type { WorkspaceData } from '@/mocks/seed'
import { daysUntil } from '@/lib/dates'
import { excerpt, normalizeText, searchTerms } from '@/lib/text'

// ---------- lookups ----------

export function tagMap(tags: Tag[]): Map<Id, Tag> {
  return new Map(tags.map((t) => [t.id, t]))
}

export function findProject(data: WorkspaceData, id: Id | null | undefined): Project | undefined {
  return id ? data.projects.find((p) => p.id === id) : undefined
}

// ---------- library ----------

export type LibrarySort = 'updated' | 'created' | 'oldest' | 'title-asc' | 'title-desc'
export const LIBRARY_SORTS: LibrarySort[] = ['updated', 'created', 'oldest', 'title-asc', 'title-desc']

export interface LibraryQuery {
  text: string
  kinds: ItemKind[]
  tagIds: Id[]
  sort: LibrarySort
}

function itemHaystack(item: KnowledgeItem, tags: Map<Id, Tag>): string {
  const tagLabels = item.tagIds.map((id) => tags.get(id)?.label ?? '').join(' ')
  return normalizeText(`${item.title} ${item.body} ${item.url ?? ''} ${tagLabels}`)
}

/** Every word of the query must appear somewhere in the item (AND semantics). */
export function matchesText(item: KnowledgeItem, query: string, tags: Map<Id, Tag>): boolean {
  const words = normalizeText(query).split(' ').filter(Boolean)
  if (words.length === 0) return true
  const hay = itemHaystack(item, tags)
  return words.every((w) => hay.includes(w))
}

export function filterLibrary(data: WorkspaceData, q: LibraryQuery, locale: string): KnowledgeItem[] {
  const tags = tagMap(data.tags)
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true })
  const result = data.items.filter(
    (item) =>
      (q.kinds.length === 0 || q.kinds.includes(item.kind)) &&
      (q.tagIds.length === 0 || q.tagIds.every((id) => item.tagIds.includes(id))) &&
      matchesText(item, q.text, tags)
  )
  const byTime = (key: 'updatedAt' | 'createdAt', dir: 1 | -1) => (a: KnowledgeItem, b: KnowledgeItem) =>
    dir * (Date.parse(a[key]) - Date.parse(b[key]))
  switch (q.sort) {
    case 'updated':
      return result.sort(byTime('updatedAt', -1))
    case 'created':
      return result.sort(byTime('createdAt', -1))
    case 'oldest':
      return result.sort(byTime('createdAt', 1))
    case 'title-asc':
      return result.sort((a, b) => collator.compare(a.title, b.title))
    case 'title-desc':
      return result.sort((a, b) => collator.compare(b.title, a.title))
  }
}

/** Tags in use, most used first. */
export function tagsByUsage(data: WorkspaceData): Array<{ tag: Tag; count: number }> {
  const counts = new Map<Id, number>()
  for (const item of data.items) for (const id of item.tagIds) counts.set(id, (counts.get(id) ?? 0) + 1)
  return data.tags
    .map((tag) => ({ tag, count: counts.get(tag.id) ?? 0 }))
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count)
}

export function recentItems(items: KnowledgeItem[], by: 'createdAt' | 'updatedAt', limit: number): KnowledgeItem[] {
  return [...items].sort((a, b) => Date.parse(b[by]) - Date.parse(a[by])).slice(0, limit)
}

// ---------- tasks ----------

export interface TaskQuery {
  status: TaskStatus | 'all' | 'open'
  priority: TaskPriority | 'all'
  projectId: Id | 'all'
}

const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 }

/** Open tasks first by due date (undated last), then by priority. */
export function compareTasks(a: Task, b: Task): number {
  if (a.dueDate !== b.dueDate) {
    if (!a.dueDate) return 1
    if (!b.dueDate) return -1
    return a.dueDate < b.dueDate ? -1 : 1
  }
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
}

export function filterTasks(tasks: Task[], q: TaskQuery): Task[] {
  return tasks
    .filter(
      (t) =>
        (q.status === 'all' || (q.status === 'open' ? t.status !== 'done' : t.status === q.status)) &&
        (q.priority === 'all' || t.priority === q.priority) &&
        (q.projectId === 'all' || t.projectId === q.projectId)
    )
    .sort(compareTasks)
}

export type TaskGroup = 'overdue' | 'today' | 'upcoming' | 'noDate' | 'done'
export const TASK_GROUPS: TaskGroup[] = ['overdue', 'today', 'upcoming', 'noDate', 'done']

export function taskGroup(task: Task, now: Date): TaskGroup {
  if (task.status === 'done') return 'done'
  if (!task.dueDate) return 'noDate'
  const d = daysUntil(task.dueDate, now)
  return d < 0 ? 'overdue' : d === 0 ? 'today' : 'upcoming'
}

export function groupTasks(tasks: Task[], now: Date): Array<{ group: TaskGroup; tasks: Task[] }> {
  const groups = new Map<TaskGroup, Task[]>(TASK_GROUPS.map((g) => [g, []]))
  for (const t of tasks) groups.get(taskGroup(t, now))?.push(t)
  const done = groups.get('done')
  done?.sort((a, b) => Date.parse(b.completedAt ?? b.updatedAt) - Date.parse(a.completedAt ?? a.updatedAt))
  return TASK_GROUPS.map((group) => ({ group, tasks: groups.get(group) ?? [] })).filter((g) => g.tasks.length > 0)
}

/** Open tasks due within `days` (including overdue ones). */
export function upcomingTasks(tasks: Task[], now: Date, days: number): Task[] {
  return tasks
    .filter((t) => t.status !== 'done' && t.dueDate !== null && daysUntil(t.dueDate, now) <= days)
    .sort(compareTasks)
}

export function openTaskCount(tasks: Task[]): number {
  return tasks.filter((t) => t.status !== 'done').length
}

// ---------- projects ----------

export interface ProjectStats {
  itemCount: number
  taskTotal: number
  taskDone: number
  openTasks: Task[]
}

export function projectStats(data: WorkspaceData, projectId: Id): ProjectStats {
  const tasks = data.tasks.filter((t) => t.projectId === projectId)
  return {
    itemCount: data.items.filter((i) => i.projectId === projectId).length,
    taskTotal: tasks.length,
    taskDone: tasks.filter((t) => t.status === 'done').length,
    openTasks: tasks.filter((t) => t.status !== 'done').sort(compareTasks)
  }
}

const STATUS_RANK: Record<Project['status'], number> = { active: 0, planning: 1, on_hold: 2, completed: 3 }

export function sortProjects(projects: Project[]): Project[] {
  return [...projects].sort(
    (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
  )
}

// ---------- global search ----------

export interface SearchHit {
  ref: SourceRef
  title: string
  snippet: string
  kind: ItemKind | 'project' | 'task'
  score: number
}

export interface GlobalResults {
  items: SearchHit[]
  projects: SearchHit[]
  tasks: SearchHit[]
  total: number
}

function score(title: string, body: string, words: string[]): number {
  const t = normalizeText(title)
  const b = normalizeText(body)
  let s = 0
  for (const w of words) {
    if (t.includes(w)) s += t.startsWith(w) ? 4 : 3
    else if (b.includes(w)) s += 1
    else return 0
  }
  return s
}

export function globalSearch(data: WorkspaceData, query: string, perGroup = 5): GlobalResults {
  const words = normalizeText(query).split(' ').filter(Boolean)
  const empty: GlobalResults = { items: [], projects: [], tasks: [], total: 0 }
  if (words.length === 0) return empty
  const tags = tagMap(data.tags)
  const top = (hits: SearchHit[]) => hits.filter((h) => h.score > 0).sort((a, b) => b.score - a.score)

  const items = top(
    data.items.map((i) => {
      const tagText = i.tagIds.map((id) => tags.get(id)?.label ?? '').join(' ')
      return {
        ref: { type: 'item', id: i.id },
        title: i.title,
        snippet: excerpt(i.body, words[0] ?? ''),
        kind: i.kind,
        score: score(i.title, `${i.body} ${i.url ?? ''} ${tagText}`, words)
      }
    })
  )
  const projects = top(
    data.projects.map((p) => ({
      ref: { type: 'project', id: p.id },
      title: p.name,
      snippet: excerpt(p.description, words[0] ?? ''),
      kind: 'project',
      score: score(p.name, p.description, words)
    }))
  )
  const tasks = top(
    data.tasks.map((t) => ({
      ref: { type: 'task', id: t.id },
      title: t.title,
      snippet: excerpt(t.notes, words[0] ?? ''),
      kind: 'task',
      score: score(t.title, t.notes, words)
    }))
  )
  return {
    items: items.slice(0, perGroup),
    projects: projects.slice(0, perGroup),
    tasks: tasks.slice(0, perGroup),
    total: items.length + projects.length + tasks.length
  }
}

// ---------- ask (prototype keyword matching, explicitly not AI) ----------

/**
 * Finds library items that contain words from a question (renderer-side
 * keyword scoring). Phase 5 Ask Your Memory no longer uses it; retrieval runs
 * in the main process (keyword + semantic). Kept as a small tested helper.
 */
export function keywordMatches(data: WorkspaceData, question: string, limit = 4): SourceRef[] {
  const terms = searchTerms(question)
  if (terms.length === 0) return []
  const tags = tagMap(data.tags)
  return data.items
    .map((item) => {
      const title = normalizeText(item.title)
      const hay = itemHaystack(item, tags)
      let s = 0
      for (const term of terms) {
        if (title.includes(term)) s += 2
        else if (hay.includes(term)) s += 1
      }
      return { item, s }
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || Date.parse(b.item.updatedAt) - Date.parse(a.item.updatedAt))
    .slice(0, limit)
    .map((x) => ({ type: 'item' as const, id: x.item.id }))
}

// ---------- briefing ----------

export function updatedWithin(items: KnowledgeItem[], now: Date, hours: number): KnowledgeItem[] {
  const since = now.getTime() - hours * 3_600_000
  return items.filter((i) => Date.parse(i.updatedAt) >= since).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
}
