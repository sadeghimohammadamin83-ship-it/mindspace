/**
 * Domain model shared by the renderer today and the main-process data layer in
 * Phase 2. Dates are ISO-8601 strings in UTC; due dates are calendar days
 * (YYYY-MM-DD) without a time zone.
 */

export type Id = string
export type IsoDateTime = string
export type IsoDate = string

/** Where a record came from, so the UI can label sample data honestly. */
export type Origin = 'sample' | 'session'

export const ITEM_KINDS = ['note', 'idea', 'link', 'decision'] as const
export type ItemKind = (typeof ITEM_KINDS)[number]

export interface Tag {
  id: Id
  label: string
}

export interface KnowledgeItem {
  id: Id
  kind: ItemKind
  title: string
  body: string
  /** Only for `link` items. */
  url?: string
  tagIds: Id[]
  projectId: Id | null
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  origin: Origin
}

export const PROJECT_STATUSES = ['planning', 'active', 'on_hold', 'completed'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export interface Project {
  id: Id
  name: string
  description: string
  status: ProjectStatus
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  origin: Origin
}

export const TASK_STATUSES = ['todo', 'in_progress', 'done'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const TASK_PRIORITIES = ['high', 'medium', 'low'] as const
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

export interface Task {
  id: Id
  title: string
  notes: string
  status: TaskStatus
  priority: TaskPriority
  dueDate: IsoDate | null
  projectId: Id | null
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  completedAt: IsoDateTime | null
  origin: Origin
}

export const DECISION_STATUSES = ['proposed', 'accepted', 'rejected', 'superseded'] as const
export type DecisionStatus = (typeof DECISION_STATUSES)[number]

/**
 * Allowed status changes. Proposed decisions are accepted or rejected; an
 * accepted decision can later be superseded by another one (or reversed);
 * a rejected one can be reopened; a superseded one can be restored.
 * Deleting is separate and always possible.
 */
export const DECISION_TRANSITIONS: Record<DecisionStatus, readonly DecisionStatus[]> = {
  proposed: ['accepted', 'rejected'],
  accepted: ['superseded', 'rejected'],
  rejected: ['proposed'],
  superseded: ['accepted']
}

/** A structured decision record (an ADR-style entry), optionally tied to a project. */
export interface Decision {
  id: Id
  projectId: Id | null
  title: string
  /** The problem or situation that called for a decision. */
  context: string
  /** What was decided. Required. */
  decision: string
  rationale: string
  alternatives: string
  consequences: string
  status: DecisionStatus
  /** Calendar day the decision was taken, when known. */
  decidedOn: IsoDate | null
  /** The decision that replaced this one; only set while status is `superseded`. */
  supersededById: Id | null
  /** Notes (knowledge items) that explain or support the decision. */
  noteIds: Id[]
  taskIds: Id[]
  tagIds: Id[]
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  origin: Origin
}

/** A pointer from an answer to a record the user owns. */
export interface SourceRef {
  type: 'item' | 'task' | 'project' | 'decision'
  id: Id
}

export type AskMessage =
  | { id: Id; role: 'user'; text: string; createdAt: IsoDateTime }
  | {
      id: Id
      role: 'assistant'
      /**
       * `illustration`: hand-written example shipped with the prototype.
       * `keyword-matches`: the prototype's honest reply, listing records whose
       * text contains words from the question. Never an AI-generated answer.
       */
      mode: 'illustration' | 'keyword-matches'
      text: string
      sources: SourceRef[]
      createdAt: IsoDateTime
    }

export interface Conversation {
  id: Id
  title: string
  messages: AskMessage[]
  createdAt: IsoDateTime
  origin: Origin
}

export const ACTIVITY_KINDS = [
  'item_captured',
  'task_created',
  'task_completed',
  'task_reopened',
  'task_updated',
  'project_created',
  'project_updated',
  'item_updated',
  'item_project_linked',
  'item_project_unlinked',
  'task_project_linked',
  'task_project_unlinked',
  'decision_created',
  'decision_updated',
  'decision_accepted',
  'decision_rejected',
  'decision_superseded',
  'decision_reopened',
  'decision_link_added',
  'decision_link_removed'
] as const
export type ActivityKind = (typeof ACTIVITY_KINDS)[number]

/** Small structured detail attached to an event, e.g. the record a link points at. */
export interface ActivityMeta {
  related?: { type: SourceRef['type']; id: Id; title: string }
}

export interface ActivityEvent {
  id: Id
  kind: ActivityKind
  /** Title of the record at the time of the event. */
  subject: string
  ref: SourceRef
  /** The project this event belongs to in the project timeline, if any. */
  projectId: Id | null
  meta?: ActivityMeta
  at: IsoDateTime
  origin: Origin
}
