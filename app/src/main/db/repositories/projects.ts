import type { Database } from 'better-sqlite3'
import type { Id, Project, ProjectStatus } from '@shared/domain'
import { fromOrigin, toOrigin, type StoredOrigin } from './rows'

interface ProjectRow {
  id: string
  name: string
  description: string
  status: ProjectStatus
  origin: StoredOrigin
  created_at: string
  updated_at: string
}

const toProject = (r: ProjectRow): Project => ({
  id: r.id,
  name: r.name,
  description: r.description,
  status: r.status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  origin: toOrigin(r.origin)
})

export function createProjectsRepo(db: Database) {
  const q = {
    get: db.prepare<[string], ProjectRow>('SELECT * FROM projects WHERE id = ?'),
    list: db.prepare<[], ProjectRow>('SELECT * FROM projects ORDER BY updated_at DESC'),
    insert: db.prepare(
      `INSERT INTO projects (id, name, description, status, origin, created_at, updated_at)
       VALUES (@id, @name, @description, @status, @origin, @created_at, @updated_at)`
    ),
    update: db.prepare(
      `UPDATE projects SET name = @name, description = @description, status = @status, updated_at = @updated_at
       WHERE id = @id`
    ),
    touch: db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?'),
    remove: db.prepare('DELETE FROM projects WHERE id = ?')
  }
  return {
    get: (id: Id): Project | null => {
      const r = q.get.get(id)
      return r ? toProject(r) : null
    },
    list: (): Project[] => q.list.all().map(toProject),
    insert(p: Project): void {
      q.insert.run({
        id: p.id,
        name: p.name,
        description: p.description,
        status: p.status,
        origin: fromOrigin(p.origin),
        created_at: p.createdAt,
        updated_at: p.updatedAt
      })
    },
    update(p: Project): void {
      q.update.run({ id: p.id, name: p.name, description: p.description, status: p.status, updated_at: p.updatedAt })
    },
    touch: (id: Id, at: string): boolean => q.touch.run(at, id).changes > 0,
    remove: (id: Id): boolean => q.remove.run(id).changes > 0
  }
}
export type ProjectsRepo = ReturnType<typeof createProjectsRepo>
