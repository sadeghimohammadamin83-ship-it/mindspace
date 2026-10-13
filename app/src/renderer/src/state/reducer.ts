/**
 * Pure state transitions for the renderer's workspace cache. Persistent
 * records only enter through `workspace/loaded` (the database snapshot) and
 * `changes/apply` (what a committed write returned), so the cache never holds
 * anything the database does not. Ask conversations stay session-only.
 */
import type { AskMessage, Conversation, Id } from '@shared/domain'
import type { ChangeSet, WorkspaceSnapshot } from '@shared/ipc'
import type { WorkspaceData } from '@/mocks/seed'

export type WorkspaceAction =
  | { type: 'workspace/loaded'; snapshot: WorkspaceSnapshot; conversations: Conversation[] }
  | { type: 'changes/apply'; changes: ChangeSet }
  | { type: 'conversation/add'; conversation: Conversation }
  | { type: 'conversation/append'; id: Id; message: AskMessage }

export const EMPTY_WORKSPACE: WorkspaceData = {
  tags: [],
  projects: [],
  items: [],
  tasks: [],
  decisions: [],
  conversations: [],
  activity: []
}

/** Replaces records that exist, prepends new ones (newest first), drops removed ids. */
function merge<T extends { id: Id }>(list: T[], updates: T[], removed: Set<Id>): T[] {
  if (!updates.length && !removed.size) return list
  const byId = new Map(updates.map((u) => [u.id, u]))
  const kept = list.filter((x) => !removed.has(x.id)).map((x) => byId.get(x.id) ?? x)
  const known = new Set(list.map((x) => x.id))
  const fresh = updates.filter((u) => !known.has(u.id))
  return fresh.length ? [...fresh.reverse(), ...kept] : kept
}

export function applyChanges(state: WorkspaceData, c: ChangeSet): WorkspaceData {
  const removedOf = (type: ChangeSet['removed'][number]['type']) =>
    new Set(c.removed.filter((r) => r.type === type).map((r) => r.id))
  const removedRefs = new Set(c.removed.map((r) => `${r.type}:${r.id}`))
  const tagUpdates = new Map(c.tags.map((t) => [t.id, t]))
  const knownTags = new Set(state.tags.map((t) => t.id))
  const knownEvents = new Set(c.activity.map((a) => a.id))
  return {
    ...state,
    // Tags keep their creation order; a rename replaces the label in place.
    tags: [
      ...state.tags.filter((t) => !removedOf('tag').has(t.id)).map((t) => tagUpdates.get(t.id) ?? t),
      ...c.tags.filter((t) => !knownTags.has(t.id))
    ],
    items: merge(state.items, c.items, removedOf('item')),
    tasks: merge(state.tasks, c.tasks, removedOf('task')),
    projects: merge(state.projects, c.projects, removedOf('project')),
    decisions: merge(state.decisions, c.decisions, removedOf('decision')),
    activity: [
      ...[...c.activity].reverse(),
      ...state.activity.filter((a) => !knownEvents.has(a.id) && !removedRefs.has(`${a.ref.type}:${a.ref.id}`))
    ]
  }
}

export function workspaceReducer(state: WorkspaceData, action: WorkspaceAction): WorkspaceData {
  switch (action.type) {
    case 'workspace/loaded':
      return { ...action.snapshot, conversations: action.conversations }
    case 'changes/apply':
      return applyChanges(state, action.changes)
    case 'conversation/add':
      return { ...state, conversations: [action.conversation, ...state.conversations] }
    case 'conversation/append':
      return {
        ...state,
        conversations: state.conversations.map((c) =>
          c.id === action.id ? { ...c, messages: [...c.messages, action.message] } : c
        )
      }
  }
}
