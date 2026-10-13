import type { Database } from 'better-sqlite3'
import type { Id, Task, TaskPriority, TaskStatus } from '@shared/domain'
import type { TaskFilter } from '@shared/contracts'
import { fromOrigin, toOrigin, type StoredOrigin } from './rows'

interface TaskRow {
  id: string
  title: string
  notes: string
  status: TaskStatus
  priority: TaskPriority
  due_date: string | null
  project_id: string | null
  origin: StoredOrigin
  created_at: string
  updated_at: string
  completed_at: string | null
}

const toTask = (r: TaskRow): Task => ({
  id: r.id,
  title: r.title,
  notes: r.notes,
  status: r.status,
  priority: r.priority,
  dueDate: r.due_date,
  projectId: r.project_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  completedAt: r.completed_at,
  origin: toOrigin(r.origin)
})

const params = (t: Task) => ({
  id: t.id,
  title: t.title,
  notes: t.notes,
  status: t.status,
  priority: t.priority,
  due_date: t.dueDate,
  project_id: t.projectId,
  origin: fromOrigin(t.origin),
  created_at: t.createdAt,
  updated_at: t.updatedAt,
  completed_at: t.completedAt
})

export function createTasksRepo(db: Database) {
  const q = {
    get: db.prepare<[string], TaskRow>('SELECT * FROM tasks WHERE id = ?'),
    list: db.prepare<[], TaskRow>('SELECT * FROM tasks ORDER BY created_at DESC'),
    filter: db.prepare<Record<string, unknown>, TaskRow>(
      `SELECT * FROM tasks
       WHERE (@status IS NULL OR status = @status)
         AND (@priority IS NULL OR priority = @priority)
         AND (@project_id IS NULL OR project_id = @project_id)
       ORDER BY status = 'done', due_date IS NULL, due_date, created_at DESC
       LIMIT @limit`
    ),
    insert: db.prepare(
      `INSERT INTO tasks (id, title, notes, status, priority, due_date, project_id, origin, created_at, updated_at, completed_at)
       VALUES (@id, @title, @notes, @status, @priority, @due_date, @project_id, @origin, @created_at, @updated_at, @completed_at)`
    ),
    update: db.prepare(
      `UPDATE tasks SET title = @title, notes = @notes, status = @status, priority = @priority, due_date = @due_date,
         project_id = @project_id, updated_at = @updated_at, completed_at = @completed_at WHERE id = @id`
    ),
    byProject: db.prepare<[string], { id: string }>('SELECT id FROM tasks WHERE project_id = ?'),
    remove: db.prepare('DELETE FROM tasks WHERE id = ?')
  }
  return {
    get: (id: Id): Task | null => {
      const r = q.get.get(id)
      return r ? toTask(r) : null
    },
    list: (): Task[] => q.list.all().map(toTask),
    filter: (f: TaskFilter): Task[] =>
      q.filter
        .all({ status: f.status ?? null, priority: f.priority ?? null, project_id: f.projectId ?? null, limit: f.limit ?? 100 })
        .map(toTask),
    idsInProject: (projectId: Id): Id[] => q.byProject.all(projectId).map((r) => r.id),
    insert: (t: Task): void => void q.insert.run(params(t)),
    update: (t: Task): void => void q.update.run(params(t)),
    remove: (id: Id): boolean => q.remove.run(id).changes > 0
  }
}
export type TasksRepo = ReturnType<typeof createTasksRepo>
