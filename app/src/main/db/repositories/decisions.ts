import type { Database } from 'better-sqlite3'
import type { Decision, DecisionStatus, Id } from '@shared/domain'
import { fromOrigin, toOrigin, type StoredOrigin } from './rows'

interface DecisionRow {
  id: string
  project_id: string | null
  title: string
  context: string
  decision: string
  rationale: string
  alternatives: string
  consequences: string
  status: DecisionStatus
  decided_on: string | null
  superseded_by: string | null
  origin: StoredOrigin
  created_at: string
  updated_at: string
}

export type LinkTarget = 'item' | 'task'

export function createDecisionsRepo(db: Database) {
  const q = {
    get: db.prepare<[string], DecisionRow>('SELECT * FROM decisions WHERE id = ?'),
    list: db.prepare<[], DecisionRow>('SELECT * FROM decisions ORDER BY updated_at DESC, rowid DESC'),
    insert: db.prepare(
      `INSERT INTO decisions (id, project_id, title, context, decision, rationale, alternatives, consequences,
         status, decided_on, superseded_by, origin, created_at, updated_at)
       VALUES (@id, @project_id, @title, @context, @decision, @rationale, @alternatives, @consequences,
         @status, @decided_on, @superseded_by, @origin, @created_at, @updated_at)`
    ),
    update: db.prepare(
      `UPDATE decisions SET project_id = @project_id, title = @title, context = @context, decision = @decision,
         rationale = @rationale, alternatives = @alternatives, consequences = @consequences,
         status = @status, decided_on = @decided_on, superseded_by = @superseded_by, updated_at = @updated_at
       WHERE id = @id`
    ),
    remove: db.prepare('DELETE FROM decisions WHERE id = ?'),
    byProject: db.prepare<[string], { id: string }>('SELECT id FROM decisions WHERE project_id = ?'),
    supersededBy: db.prepare<[string], { id: string }>('SELECT id FROM decisions WHERE superseded_by = ?'),
    allItems: db.prepare<[], { decision_id: string; item_id: string }>(
      'SELECT decision_id, item_id FROM decision_items ORDER BY created_at, rowid'
    ),
    allTasks: db.prepare<[], { decision_id: string; task_id: string }>(
      'SELECT decision_id, task_id FROM decision_tasks ORDER BY created_at, rowid'
    ),
    allTags: db.prepare<[], { decision_id: string; tag_id: string }>(
      'SELECT decision_id, tag_id FROM decision_tags ORDER BY rowid'
    ),
    itemsOf: db.prepare<[string], { item_id: string }>('SELECT item_id FROM decision_items WHERE decision_id = ? ORDER BY created_at, rowid'),
    tasksOf: db.prepare<[string], { task_id: string }>('SELECT task_id FROM decision_tasks WHERE decision_id = ? ORDER BY created_at, rowid'),
    tagsOf: db.prepare<[string], { tag_id: string }>('SELECT tag_id FROM decision_tags WHERE decision_id = ? ORDER BY rowid'),
    forItem: db.prepare<[string], { id: string }>('SELECT decision_id AS id FROM decision_items WHERE item_id = ?'),
    forTask: db.prepare<[string], { id: string }>('SELECT decision_id AS id FROM decision_tasks WHERE task_id = ?'),
    unlinkTags: db.prepare('DELETE FROM decision_tags WHERE decision_id = ?'),
    linkTag: db.prepare('INSERT OR IGNORE INTO decision_tags (decision_id, tag_id) VALUES (?, ?)'),
    link: {
      item: db.prepare('INSERT OR IGNORE INTO decision_items (decision_id, item_id, created_at) VALUES (?, ?, ?)'),
      task: db.prepare('INSERT OR IGNORE INTO decision_tasks (decision_id, task_id, created_at) VALUES (?, ?, ?)')
    },
    unlink: {
      item: db.prepare('DELETE FROM decision_items WHERE decision_id = ? AND item_id = ?'),
      task: db.prepare('DELETE FROM decision_tasks WHERE decision_id = ? AND task_id = ?')
    }
  }

  const toDecision = (r: DecisionRow, noteIds: Id[], taskIds: Id[], tagIds: Id[]): Decision => ({
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    context: r.context,
    decision: r.decision,
    rationale: r.rationale,
    alternatives: r.alternatives,
    consequences: r.consequences,
    status: r.status,
    decidedOn: r.decided_on,
    supersededById: r.superseded_by,
    noteIds,
    taskIds,
    tagIds,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    origin: toOrigin(r.origin)
  })

  const params = (d: Decision) => ({
    id: d.id,
    project_id: d.projectId,
    title: d.title,
    context: d.context,
    decision: d.decision,
    rationale: d.rationale,
    alternatives: d.alternatives,
    consequences: d.consequences,
    status: d.status,
    decided_on: d.decidedOn,
    superseded_by: d.supersededById,
    origin: fromOrigin(d.origin),
    created_at: d.createdAt,
    updated_at: d.updatedAt
  })

  const group = <T extends Record<string, string>>(rows: T[], key: keyof T, value: keyof T) => {
    const m = new Map<string, Id[]>()
    for (const r of rows) {
      const list = m.get(r[key]!)
      if (list) list.push(r[value]!)
      else m.set(r[key]!, [r[value]!])
    }
    return m
  }

  return {
    get(id: Id): Decision | null {
      const r = q.get.get(id)
      if (!r) return null
      return toDecision(
        r,
        q.itemsOf.all(id).map((x) => x.item_id),
        q.tasksOf.all(id).map((x) => x.task_id),
        q.tagsOf.all(id).map((x) => x.tag_id)
      )
    },
    list(): Decision[] {
      const notes = group(q.allItems.all(), 'decision_id', 'item_id')
      const tasks = group(q.allTasks.all(), 'decision_id', 'task_id')
      const tags = group(q.allTags.all(), 'decision_id', 'tag_id')
      return q.list.all().map((r) => toDecision(r, notes.get(r.id) ?? [], tasks.get(r.id) ?? [], tags.get(r.id) ?? []))
    },
    insert: (d: Decision): void => void q.insert.run(params(d)),
    update: (d: Decision): void => void q.update.run(params(d)),
    remove: (id: Id): boolean => q.remove.run(id).changes > 0,
    idsInProject: (projectId: Id): Id[] => q.byProject.all(projectId).map((r) => r.id),
    idsSupersededBy: (id: Id): Id[] => q.supersededBy.all(id).map((r) => r.id),
    idsLinkedTo: (target: LinkTarget, id: Id): Id[] => (target === 'item' ? q.forItem : q.forTask).all(id).map((r) => r.id),
    /** Returns true when a new link row was created. */
    link: (decisionId: Id, target: LinkTarget, targetId: Id, at: string): boolean =>
      q.link[target].run(decisionId, targetId, at).changes > 0,
    /** Removes only the link row; both records stay. Returns true when a link existed. */
    unlink: (decisionId: Id, target: LinkTarget, targetId: Id): boolean =>
      q.unlink[target].run(decisionId, targetId).changes > 0,
    setTags(decisionId: Id, tagIds: Id[]): void {
      q.unlinkTags.run(decisionId)
      for (const tagId of tagIds) q.linkTag.run(decisionId, tagId)
    }
  }
}
export type DecisionsRepo = ReturnType<typeof createDecisionsRepo>
