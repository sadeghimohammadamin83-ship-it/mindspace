/**
 * Application service for persistent workspace data. Validates every input
 * (types and business rules), runs multi-step writes in one transaction, and
 * returns a ChangeSet describing exactly what was committed.
 */
import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import { z } from 'zod'
import {
  activityQuerySchema,
  decisionCreateSchema,
  decisionLinkSchema,
  decisionPatchSchema,
  decisionStatusSchema,
  idSchema,
  itemCreateSchema,
  itemPatchSchema,
  itemSearchSchema,
  preferencesPatchSchema,
  projectCreateSchema,
  projectPatchSchema,
  taskCreateSchema,
  taskFilterSchema,
  taskPatchSchema,
  tagCreateSchema,
  tagRenameSchema,
  type StoredPreferences
} from '@shared/contracts'
import { DECISION_TRANSITIONS, TASK_STATUSES } from '@shared/domain'
import type {
  ActivityEvent,
  ActivityKind,
  ActivityMeta,
  Decision,
  Id,
  KnowledgeItem,
  Project,
  SourceRef,
  Tag,
  Task,
  TaskStatus
} from '@shared/domain'
import type { ChangeSet, DataErrorCode, WorkspaceSnapshot } from '@shared/ipc'
import { createActivityRepo } from '../db/repositories/activity'
import { createDecisionsRepo } from '../db/repositories/decisions'
import { createItemsRepo } from '../db/repositories/items'
import { createPreferencesRepo } from '../db/repositories/preferences'
import { createProjectsRepo } from '../db/repositories/projects'
import { createTagsRepo } from '../db/repositories/tags'
import { createTasksRepo } from '../db/repositories/tasks'

export class DataError extends Error {
  constructor(
    readonly code: DataErrorCode,
    message: string,
    readonly fields?: Record<string, string>
  ) {
    super(message)
    this.name = 'DataError'
  }
}

function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const r = schema.safeParse(value)
  if (r.success) return r.data
  const fields: Record<string, string> = {}
  for (const issue of r.error.issues) fields[issue.path.join('.') || '_'] ??= issue.message
  throw new DataError('validation', 'Invalid input', fields)
}

const emptyChanges = (): ChangeSet => ({
  tags: [],
  projects: [],
  items: [],
  tasks: [],
  decisions: [],
  activity: [],
  removed: []
})
const newId = (prefix: string) => `${prefix}-${randomUUID()}`

export function createWorkspaceService(db: Database, now: () => Date = () => new Date()) {
  const projects = createProjectsRepo(db)
  const items = createItemsRepo(db)
  const tasks = createTasksRepo(db)
  const tags = createTagsRepo(db)
  const decisions = createDecisionsRepo(db)
  const activity = createActivityRepo(db)
  const prefs = createPreferencesRepo(db)

  /** Runs `fn` atomically; any thrown error rolls back every statement. */
  const tx = <T>(fn: () => T): T => db.transaction(fn).immediate()

  function requireProject(id: Id | null, changes: ChangeSet, at: string): void {
    if (id === null) return
    if (!projects.touch(id, at)) throw new DataError('not_found', 'Project not found', { projectId: 'Project not found' })
    changes.projects.push(projects.get(id)!)
  }

  /** Appends an event to the timeline in the same transaction as the change it describes. */
  function record(
    changes: ChangeSet,
    kind: ActivityKind,
    subject: string,
    ref: SourceRef,
    at: string,
    projectId: Id | null,
    meta?: ActivityMeta
  ): void {
    const e: ActivityEvent = {
      id: newId('act'),
      kind,
      subject,
      ref,
      projectId,
      ...(meta ? { meta } : {}),
      at,
      origin: 'session'
    }
    activity.insert(e)
    changes.activity.push(e)
  }

  const projectRelated = (id: Id): ActivityMeta | undefined => {
    const p = projects.get(id)
    return p ? { related: { type: 'project', id, title: p.name } } : undefined
  }

  /** Re-reads decisions after a cascade (deleted note, task, tag, project or replacement). */
  function addDecisions(changes: ChangeSet, ids: Id[]): void {
    for (const id of ids) {
      const d = decisions.get(id)
      if (d && !changes.decisions.some((x) => x.id === id)) changes.decisions.push(d)
    }
  }

  const uniq = (ids: Id[]): Id[] => [...new Set(ids)]

  function ensureTags(labels: string[], changes: ChangeSet, at: string): Id[] {
    const ids: Id[] = []
    for (const label of labels) {
      const { tag, created } = tags.ensure(label, () => newId('tag'), at)
      if (created) changes.tags.push(tag)
      if (!ids.includes(tag.id)) ids.push(tag.id)
    }
    return ids
  }

  function setStatus(current: Task, status: TaskStatus, at: string): Task {
    if (current.status === status) return current
    return { ...current, status, completedAt: status === 'done' ? at : null }
  }

  /** Touches the project's updated_at when the record points at an existing project. */
  function requireProjectIfAny(id: Id | null, changes: ChangeSet, at: string): void {
    if (id === null || !projects.get(id)) return
    requireProject(id, changes, at)
  }

  function setDecisionLink(input: unknown, add: boolean): ChangeSet {
    const v = parse(decisionLinkSchema, input)
    return tx(() => {
      const decision = decisions.get(v.decisionId)
      if (!decision) throw new DataError('not_found', 'Decision not found')
      const target = v.targetType === 'item' ? items.get(v.targetId) : tasks.get(v.targetId)
      if (!target) throw new DataError('not_found', v.targetType === 'item' ? 'Note not found' : 'Task not found')
      const at = now().toISOString()
      const changed = add
        ? decisions.link(v.decisionId, v.targetType, v.targetId, at)
        : decisions.unlink(v.decisionId, v.targetType, v.targetId)
      const changes = emptyChanges()
      changes.decisions.push(decisions.get(v.decisionId)!)
      if (changed) {
        record(
          changes,
          add ? 'decision_link_added' : 'decision_link_removed',
          decision.title,
          { type: 'decision', id: decision.id },
          at,
          decision.projectId,
          { related: { type: v.targetType, id: target.id, title: target.title } }
        )
      }
      return changes
    })
  }

  return {
    loadWorkspace(): WorkspaceSnapshot {
      return db
        .transaction(() => ({
          tags: tags.list(),
          projects: projects.list(),
          items: items.list(),
          tasks: tasks.list(),
          decisions: decisions.list(),
          activity: activity.recent()
        }))
        .deferred()
    },

    // Notes, ideas, links and decisions -------------------------------------------------
    getItem(id: unknown): KnowledgeItem {
      const item = items.get(parse(idSchema, id))
      if (!item) throw new DataError('not_found', 'Item not found')
      return item
    },
    searchItems: (query: unknown): KnowledgeItem[] => items.search(parse(itemSearchSchema, query)),

    createItem(input: unknown): ChangeSet {
      const v = parse(itemCreateSchema, input)
      return tx(() => {
        const at = now().toISOString()
        const changes = emptyChanges()
        requireProject(v.projectId, changes, at)
        const url = v.kind === 'link' ? v.url.trim() : ''
        const item: KnowledgeItem = {
          id: newId('item'),
          kind: v.kind,
          title: v.title,
          body: v.body.trim(),
          ...(url ? { url } : {}),
          tagIds: ensureTags(v.tagLabels, changes, at),
          projectId: v.projectId,
          createdAt: at,
          updatedAt: at,
          origin: 'session'
        }
        items.insert(item)
        tags.setItemTags(item.id, item.tagIds)
        changes.items.push(item)
        record(changes, 'item_captured', item.title, { type: 'item', id: item.id }, at, item.projectId)
        return changes
      })
    },

    updateItem(id: unknown, patch: unknown): ChangeSet {
      const itemId = parse(idSchema, id)
      const p = parse(itemPatchSchema, patch)
      return tx(() => {
        const current = items.get(itemId)
        if (!current) throw new DataError('not_found', 'Item not found')
        const at = now().toISOString()
        const changes = emptyChanges()
        const next: KnowledgeItem = { ...current, updatedAt: at }
        if (p.title !== undefined) next.title = p.title
        if (p.body !== undefined) next.body = p.body.trim()
        if (p.url !== undefined) {
          if (current.kind === 'link' && !p.url) throw new DataError('validation', 'A link needs a URL', { url: 'Required' })
          if (p.url) next.url = p.url
          else delete next.url
        }
        const projectChanged = p.projectId !== undefined && p.projectId !== current.projectId
        if (projectChanged) {
          requireProject(p.projectId!, changes, at)
          if (current.projectId) requireProject(current.projectId, changes, at)
          next.projectId = p.projectId!
        }
        if (p.tagLabels !== undefined) {
          next.tagIds = ensureTags(p.tagLabels, changes, at)
          tags.setItemTags(itemId, next.tagIds)
        }
        const contentChanged =
          next.title !== current.title ||
          next.body !== current.body ||
          next.url !== current.url ||
          next.tagIds.join() !== current.tagIds.join()
        items.update(next)
        changes.items.push(next)
        const ref = { type: 'item' as const, id: itemId }
        if (contentChanged) record(changes, 'item_updated', next.title, ref, at, next.projectId)
        if (projectChanged) {
          if (current.projectId) {
            record(changes, 'item_project_unlinked', next.title, ref, at, current.projectId, projectRelated(current.projectId))
          }
          if (next.projectId) {
            record(changes, 'item_project_linked', next.title, ref, at, next.projectId, projectRelated(next.projectId))
          }
        }
        return changes
      })
    },

    deleteItem(id: unknown): ChangeSet {
      const itemId = parse(idSchema, id)
      return tx(() => {
        const changes = emptyChanges()
        const linked = decisions.idsLinkedTo('item', itemId)
        activity.removeFor({ type: 'item', id: itemId })
        if (!items.remove(itemId)) throw new DataError('not_found', 'Item not found')
        changes.removed.push({ type: 'item', id: itemId })
        addDecisions(changes, linked) // their note links were removed with the note
        return changes
      })
    },

    // Projects ---------------------------------------------------------------------------
    getProject(id: unknown): Project {
      const p = projects.get(parse(idSchema, id))
      if (!p) throw new DataError('not_found', 'Project not found')
      return p
    },
    listProjects: (): Project[] => projects.list(),

    createProject(input: unknown): ChangeSet {
      const v = parse(projectCreateSchema, input)
      return tx(() => {
        const at = now().toISOString()
        const changes = emptyChanges()
        const project: Project = {
          id: newId('proj'),
          name: v.name,
          description: v.description.trim(),
          status: v.status,
          createdAt: at,
          updatedAt: at,
          origin: 'session'
        }
        projects.insert(project)
        changes.projects.push(project)
        record(changes, 'project_created', project.name, { type: 'project', id: project.id }, at, project.id)
        return changes
      })
    },

    updateProject(id: unknown, patch: unknown): ChangeSet {
      const projectId = parse(idSchema, id)
      const p = parse(projectPatchSchema, patch)
      return tx(() => {
        const current = projects.get(projectId)
        if (!current) throw new DataError('not_found', 'Project not found')
        const next: Project = {
          ...current,
          ...(p.name !== undefined ? { name: p.name } : {}),
          ...(p.description !== undefined ? { description: p.description.trim() } : {}),
          ...(p.status !== undefined ? { status: p.status } : {}),
          updatedAt: now().toISOString()
        }
        projects.update(next)
        const changes: ChangeSet = { ...emptyChanges(), projects: [next] }
        if (next.name !== current.name || next.description !== current.description || next.status !== current.status) {
          record(changes, 'project_updated', next.name, { type: 'project', id: projectId }, next.updatedAt, projectId)
        }
        return changes
      })
    },

    /**
     * Deletes a project. Its notes and tasks are kept and become unassigned
     * (ON DELETE SET NULL); the ChangeSet carries their new state.
     */
    deleteProject(id: unknown): ChangeSet {
      const projectId = parse(idSchema, id)
      return tx(() => {
        const changes = emptyChanges()
        const itemIds = items.idsInProject(projectId)
        const taskIds = tasks.idsInProject(projectId)
        const decisionIds = decisions.idsInProject(projectId)
        activity.removeFor({ type: 'project', id: projectId })
        if (!projects.remove(projectId)) throw new DataError('not_found', 'Project not found')
        changes.items.push(...itemIds.map((i) => items.get(i)!))
        changes.tasks.push(...taskIds.map((t) => tasks.get(t)!))
        addDecisions(changes, decisionIds)
        changes.removed.push({ type: 'project', id: projectId })
        return changes
      })
    },

    // Tasks ------------------------------------------------------------------------------
    getTask(id: unknown): Task {
      const t = tasks.get(parse(idSchema, id))
      if (!t) throw new DataError('not_found', 'Task not found')
      return t
    },
    listTasks: (filter: unknown): Task[] => tasks.filter(parse(taskFilterSchema, filter)),

    createTask(input: unknown): ChangeSet {
      const v = parse(taskCreateSchema, input)
      return tx(() => {
        const at = now().toISOString()
        const changes = emptyChanges()
        requireProject(v.projectId, changes, at)
        const task: Task = {
          id: newId('task'),
          title: v.title,
          notes: v.notes.trim(),
          status: v.status,
          priority: v.priority,
          dueDate: v.dueDate,
          projectId: v.projectId,
          createdAt: at,
          updatedAt: at,
          completedAt: v.status === 'done' ? at : null,
          origin: 'session'
        }
        tasks.insert(task)
        changes.tasks.push(task)
        record(changes, 'task_created', task.title, { type: 'task', id: task.id }, at, task.projectId)
        return changes
      })
    },

    updateTask(id: unknown, patch: unknown): ChangeSet {
      const taskId = parse(idSchema, id)
      const p = parse(taskPatchSchema, patch)
      return tx(() => {
        const current = tasks.get(taskId)
        if (!current) throw new DataError('not_found', 'Task not found')
        const at = now().toISOString()
        const changes = emptyChanges()
        let next: Task = {
          ...current,
          ...(p.title !== undefined ? { title: p.title } : {}),
          ...(p.notes !== undefined ? { notes: p.notes.trim() } : {}),
          ...(p.priority !== undefined ? { priority: p.priority } : {}),
          ...(p.dueDate !== undefined ? { dueDate: p.dueDate } : {}),
          ...(p.projectId !== undefined ? { projectId: p.projectId } : {}),
          updatedAt: at
        }
        if (p.status !== undefined) next = setStatus(next, p.status, at)
        if (next.projectId !== current.projectId) {
          requireProject(next.projectId, changes, at)
          if (current.projectId) requireProject(current.projectId, changes, at)
        } else if (next.projectId) {
          requireProject(next.projectId, changes, at)
        }
        tasks.update(next)
        changes.tasks.push(next)
        const ref = { type: 'task' as const, id: taskId }
        const fieldsChanged =
          next.title !== current.title ||
          next.notes !== current.notes ||
          next.priority !== current.priority ||
          next.dueDate !== current.dueDate
        if (next.status !== current.status) {
          const kind: ActivityKind =
            next.status === 'done' ? 'task_completed' : current.status === 'done' ? 'task_reopened' : 'task_updated'
          record(changes, kind, next.title, ref, at, next.projectId)
        }
        if (fieldsChanged) record(changes, 'task_updated', next.title, ref, at, next.projectId)
        if (next.projectId !== current.projectId) {
          if (current.projectId) {
            record(changes, 'task_project_unlinked', next.title, ref, at, current.projectId, projectRelated(current.projectId))
          }
          if (next.projectId) {
            record(changes, 'task_project_linked', next.title, ref, at, next.projectId, projectRelated(next.projectId))
          }
        }
        return changes
      })
    },

    setTaskStatus(id: unknown, status: unknown): ChangeSet {
      const taskId = parse(idSchema, id)
      const s = parse(z.enum(TASK_STATUSES), status)
      return tx(() => {
        const current = tasks.get(taskId)
        if (!current) throw new DataError('not_found', 'Task not found')
        const changes = emptyChanges()
        if (current.status === s) return { ...changes, tasks: [current] }
        const at = now().toISOString()
        const next = { ...setStatus(current, s, at), updatedAt: at }
        tasks.update(next)
        requireProject(next.projectId, changes, at)
        changes.tasks.push(next)
        const kind: ActivityKind = s === 'done' ? 'task_completed' : current.status === 'done' ? 'task_reopened' : 'task_updated'
        record(changes, kind, next.title, { type: 'task', id: taskId }, at, next.projectId)
        return changes
      })
    },

    completeTask(id: unknown): ChangeSet {
      return this.setTaskStatus(id, 'done')
    },

    deleteTask(id: unknown): ChangeSet {
      const taskId = parse(idSchema, id)
      return tx(() => {
        const changes = emptyChanges()
        const linked = decisions.idsLinkedTo('task', taskId)
        activity.removeFor({ type: 'task', id: taskId })
        if (!tasks.remove(taskId)) throw new DataError('not_found', 'Task not found')
        changes.removed.push({ type: 'task', id: taskId })
        addDecisions(changes, linked)
        return changes
      })
    },

    // Decisions --------------------------------------------------------------------------
    getDecision(id: unknown): Decision {
      const d = decisions.get(parse(idSchema, id))
      if (!d) throw new DataError('not_found', 'Decision not found')
      return d
    },
    listDecisions: (): Decision[] => decisions.list(),

    createDecision(input: unknown): ChangeSet {
      const v = parse(decisionCreateSchema, input)
      return tx(() => {
        const at = now().toISOString()
        const changes = emptyChanges()
        requireProject(v.projectId, changes, at)
        const noteIds = uniq(v.noteIds)
        const taskIds = uniq(v.taskIds)
        for (const id of noteIds) if (!items.get(id)) throw new DataError('not_found', 'Linked note not found', { noteIds: id })
        for (const id of taskIds) if (!tasks.get(id)) throw new DataError('not_found', 'Linked task not found', { taskIds: id })
        const decision: Decision = {
          id: newId('dec'),
          projectId: v.projectId,
          title: v.title,
          context: v.context.trim(),
          decision: v.decision,
          rationale: v.rationale.trim(),
          alternatives: v.alternatives.trim(),
          consequences: v.consequences.trim(),
          status: v.status,
          decidedOn: v.decidedOn,
          supersededById: null,
          noteIds,
          taskIds,
          tagIds: ensureTags(v.tagLabels, changes, at),
          createdAt: at,
          updatedAt: at,
          origin: 'session'
        }
        decisions.insert(decision)
        for (const id of noteIds) decisions.link(decision.id, 'item', id, at)
        for (const id of taskIds) decisions.link(decision.id, 'task', id, at)
        decisions.setTags(decision.id, decision.tagIds)
        changes.decisions.push(decision)
        record(changes, 'decision_created', decision.title, { type: 'decision', id: decision.id }, at, decision.projectId)
        return changes
      })
    },

    updateDecision(id: unknown, patch: unknown): ChangeSet {
      const decisionId = parse(idSchema, id)
      const p = parse(decisionPatchSchema, patch)
      return tx(() => {
        const current = decisions.get(decisionId)
        if (!current) throw new DataError('not_found', 'Decision not found')
        const at = now().toISOString()
        const changes = emptyChanges()
        const next: Decision = {
          ...current,
          ...(p.title !== undefined ? { title: p.title } : {}),
          ...(p.context !== undefined ? { context: p.context.trim() } : {}),
          ...(p.decision !== undefined ? { decision: p.decision } : {}),
          ...(p.rationale !== undefined ? { rationale: p.rationale.trim() } : {}),
          ...(p.alternatives !== undefined ? { alternatives: p.alternatives.trim() } : {}),
          ...(p.consequences !== undefined ? { consequences: p.consequences.trim() } : {}),
          ...(p.decidedOn !== undefined ? { decidedOn: p.decidedOn } : {}),
          ...(p.projectId !== undefined ? { projectId: p.projectId } : {}),
          updatedAt: at
        }
        if (p.tagLabels !== undefined) next.tagIds = ensureTags(p.tagLabels, changes, at)
        const changed =
          next.projectId !== current.projectId ||
          next.tagIds.join() !== current.tagIds.join() ||
          (['title', 'context', 'decision', 'rationale', 'alternatives', 'consequences', 'decidedOn'] as const).some(
            (k) => next[k] !== current[k]
          )
        if (!changed) return { ...emptyChanges(), tags: changes.tags, decisions: [current] }
        if (next.projectId !== current.projectId) {
          requireProject(next.projectId, changes, at)
          if (current.projectId) requireProject(current.projectId, changes, at)
        } else if (next.projectId) {
          requireProject(next.projectId, changes, at)
        }
        decisions.update(next)
        decisions.setTags(decisionId, next.tagIds)
        changes.decisions.push(decisions.get(decisionId)!)
        record(changes, 'decision_updated', next.title, { type: 'decision', id: decisionId }, at, next.projectId)
        return changes
      })
    },

    /**
     * Moves a decision through its lifecycle (see DECISION_TRANSITIONS). Marking
     * a decision superseded needs the replacement; the original row, text and
     * links are kept so the history stays readable.
     */
    setDecisionStatus(input: unknown): ChangeSet {
      const v = parse(decisionStatusSchema, input)
      return tx(() => {
        const current = decisions.get(v.id)
        if (!current) throw new DataError('not_found', 'Decision not found')
        const replacementId = v.supersededById ?? null
        if (v.status !== 'superseded' && replacementId) {
          throw new DataError('validation', 'Only a superseded decision has a replacement', { supersededById: 'Not allowed' })
        }
        const sameStatus = current.status === v.status
        if (sameStatus && v.status !== 'superseded') return { ...emptyChanges(), decisions: [current] }
        if (!sameStatus && !DECISION_TRANSITIONS[current.status].includes(v.status)) {
          throw new DataError('conflict', `A ${current.status} decision cannot become ${v.status}`, { status: 'Not allowed' })
        }
        if (v.status === 'superseded') {
          if (!replacementId) throw new DataError('validation', 'Choose the replacement decision', { supersededById: 'Required' })
          if (replacementId === v.id) {
            throw new DataError('validation', 'A decision cannot replace itself', { supersededById: 'Choose another decision' })
          }
          const replacement = decisions.get(replacementId)
          if (!replacement) throw new DataError('not_found', 'Replacement decision not found', { supersededById: 'Not found' })
          if (replacement.status === 'rejected') {
            throw new DataError('validation', 'A rejected decision cannot replace another', { supersededById: 'Choose another decision' })
          }
          // Walk the replacement chain; reaching this decision again would be a loop.
          for (let cur: Decision | null = replacement, hops = 0; cur?.supersededById && hops < 1000; hops++) {
            if (cur.supersededById === v.id) {
              throw new DataError('conflict', 'That would create a replacement loop', { supersededById: 'Creates a loop' })
            }
            cur = decisions.get(cur.supersededById)
          }
        }
        const at = now().toISOString()
        const changes = emptyChanges()
        const next: Decision = {
          ...current,
          status: v.status,
          supersededById: v.status === 'superseded' ? replacementId : null,
          updatedAt: at
        }
        decisions.update(next)
        requireProjectIfAny(next.projectId, changes, at)
        changes.decisions.push(decisions.get(v.id)!)
        const kind: ActivityKind =
          v.status === 'accepted'
            ? 'decision_accepted'
            : v.status === 'rejected'
              ? 'decision_rejected'
              : v.status === 'superseded'
                ? 'decision_superseded'
                : 'decision_reopened'
        const replacement = replacementId ? decisions.get(replacementId) : null
        record(
          changes,
          kind,
          next.title,
          { type: 'decision', id: v.id },
          at,
          next.projectId,
          replacement ? { related: { type: 'decision', id: replacement.id, title: replacement.title } } : undefined
        )
        return changes
      })
    },

    deleteDecision(id: unknown): ChangeSet {
      const decisionId = parse(idSchema, id)
      return tx(() => {
        const current = decisions.get(decisionId)
        if (!current) throw new DataError('not_found', 'Decision not found')
        const changes = emptyChanges()
        const replaced = decisions.idsSupersededBy(decisionId)
        activity.removeFor({ type: 'decision', id: decisionId })
        decisions.remove(decisionId) // link rows go with it; notes and tasks stay
        changes.removed.push({ type: 'decision', id: decisionId })
        addDecisions(changes, replaced) // they lose their replacement pointer but stay superseded
        requireProjectIfAny(current.projectId, changes, now().toISOString())
        return changes
      })
    },

    linkDecision: (input: unknown): ChangeSet => setDecisionLink(input, true),
    unlinkDecision: (input: unknown): ChangeSet => setDecisionLink(input, false),

    listProjectActivity(query: unknown): ActivityEvent[] {
      const q = parse(activityQuerySchema, query)
      return activity.forProject(q.projectId, q.limit, q.before)
    },

    // Tags & preferences -----------------------------------------------------------------
    /** Creates a tag, or returns the existing one with the same normalised label. */
    createTag(input: unknown): ChangeSet {
      const v = parse(tagCreateSchema, input)
      return tx(() => {
        const { tag } = tags.ensure(v.label, () => newId('tag'), now().toISOString())
        return { ...emptyChanges(), tags: [tag] }
      })
    },
    renameTag(input: unknown): ChangeSet {
      const v = parse(tagRenameSchema, input)
      return tx(() => {
        if (!tags.get(v.id)) throw new DataError('not_found', 'Tag not found')
        if (!tags.rename(v.id, v.label)) {
          throw new DataError('conflict', 'A tag with this name already exists', { label: 'A tag with this name already exists' })
        }
        return { ...emptyChanges(), tags: [tags.get(v.id)!] }
      })
    },
    /** Deletes only the tag and its links; the notes and decisions that used it are untouched. */
    deleteTag(id: unknown): ChangeSet {
      const tagId = parse(idSchema, id)
      return tx(() => {
        const itemIds = tags.itemIdsWith(tagId)
        const decisionIds = tags.decisionIdsWith(tagId)
        if (!tags.remove(tagId)) throw new DataError('not_found', 'Tag not found')
        const changes = emptyChanges()
        changes.items.push(...itemIds.map((i) => items.get(i)!))
        addDecisions(changes, decisionIds)
        changes.removed.push({ type: 'tag', id: tagId })
        return changes
      })
    },
    listTags: (): Tag[] => tags.list(),
    getPreferences: (): Partial<StoredPreferences> => prefs.getAll(),
    setPreferences(patch: unknown): null {
      const p = parse(preferencesPatchSchema, patch)
      tx(() => prefs.set(p))
      return null
    }
  }
}

export type WorkspaceService = ReturnType<typeof createWorkspaceService>
