/**
 * Workspace provider: loads persistent data from the main process once, keeps
 * it as a cache in a reducer, and exposes commands.
 *
 * SQLite (via the preload bridge) is the source of truth. Every write command
 * waits for the database to commit, then applies the returned ChangeSet, so
 * no screen ever shows a save that did not happen. Ask Your Memory does not
 * use this cache: it retrieves evidence through the retrieval bridge.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type {
  ActivityEvent,
  Decision,
  Id,
  ItemKind,
  KnowledgeItem,
  Project,
  ProjectStatus,
  Tag,
  Task,
  TaskPriority,
  TaskStatus
} from '@shared/domain'
import type {
  ActivityQuery,
  DecisionCreateInput,
  DecisionLinkInput,
  DecisionPatch,
  DecisionStatusInput,
  ItemPatch,
  TaskPatchInput
} from '@shared/contracts'
import type { ChangeSet, DataBridge, DataResult } from '@shared/ipc'
import type { WorkspaceData } from '@/mocks/seed'
import { EMPTY_WORKSPACE, workspaceReducer } from './reducer'

export interface CaptureInput {
  kind: ItemKind
  title: string
  body: string
  url: string
  tagLabels: string[]
  projectId: Id | null
}

export interface TaskInput {
  title: string
  notes: string
  status: TaskStatus
  priority: TaskPriority
  dueDate: string | null
  projectId: Id | null
}

export interface ProjectInput {
  name: string
  description: string
  status: ProjectStatus
}

export type TaskPatch = TaskPatchInput

/** A write the database rejected or could not perform. Nothing was saved. */
export class SaveError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {}
  ) {
    super(message)
    this.name = 'SaveError'
  }
}

export interface WorkspaceCommands {
  captureItem(input: CaptureInput): Promise<KnowledgeItem>
  createTask(input: TaskInput): Promise<Task>
  updateTask(id: Id, patch: TaskPatch): Promise<void>
  setTaskStatus(id: Id, status: TaskStatus): Promise<void>
  createProject(input: ProjectInput): Promise<Project>
  updateItem(id: Id, patch: ItemPatch): Promise<KnowledgeItem>
  createDecision(input: DecisionCreateInput): Promise<Decision>
  updateDecision(id: Id, patch: DecisionPatch): Promise<Decision>
  setDecisionStatus(input: DecisionStatusInput): Promise<Decision>
  deleteDecision(id: Id): Promise<void>
  linkDecision(input: DecisionLinkInput): Promise<void>
  unlinkDecision(input: DecisionLinkInput): Promise<void>
  /** Creates a tag, or returns the existing one with the same normalised label. */
  createTag(label: string): Promise<Tag>
  renameTag(id: Id, label: string): Promise<void>
  deleteTag(id: Id): Promise<void>
  /** Reads a project's timeline straight from the database (not cached). */
  loadProjectActivity(query: ActivityQuery): Promise<ActivityEvent[]>
  markActivityRead(): void
}

export type LoadState = { status: 'loading' } | { status: 'ready' } | { status: 'error'; message: string }

interface WorkspaceContextValue {
  data: WorkspaceData
  commands: WorkspaceCommands
  /** Activity events newer than this were not yet seen in the activity panel. */
  activitySeenAt: number
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

async function unwrap<T>(pending: Promise<DataResult<T>>): Promise<T> {
  let result: DataResult<T>
  try {
    result = await pending
  } catch {
    throw new SaveError('internal', 'The app could not reach its database')
  }
  if (!result.ok) throw new SaveError(result.error.code, result.error.message, result.error.fields)
  return result.value
}

/** The bridge exposed by preload, or null outside Electron. */
export function defaultDataApi(): DataBridge | null {
  return typeof window !== 'undefined' ? (window.mindspace?.data ?? null) : null
}

interface ProviderProps {
  children: ReactNode
  /** Data API; defaults to the preload bridge. Tests inject one backed by a temporary database. */
  api?: DataBridge | null
  /** Rendered while loading or after a load failure, instead of the app. */
  fallback?: (state: LoadState, retry: () => void) => ReactNode
  now?: () => Date
}

export function WorkspaceProvider({ children, api = defaultDataApi(), fallback, now = () => new Date() }: ProviderProps) {
  const [data, dispatch] = useReducer(workspaceReducer, EMPTY_WORKSPACE)
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const dataRef = useRef(data)
  dataRef.current = data
  const [activitySeenAt, setActivitySeenAt] = useState(() => now().getTime())
  const nowRef = useRef(now)
  nowRef.current = now
  const apiRef = useRef(api)
  apiRef.current = api

  useEffect(() => {
    let cancelled = false
    setLoad({ status: 'loading' })
    if (!api) {
      setLoad({ status: 'error', message: 'unavailable' })
      return
    }
    unwrap(api.loadWorkspace()).then(
      (snapshot) => {
        if (cancelled) return
        // Phase 5: the old hand-written Ask illustration is gone; Ask now retrieves real evidence.
        dispatch({ type: 'workspace/loaded', snapshot, conversations: [] })
        setLoad({ status: 'ready' })
      },
      (err: unknown) => {
        if (!cancelled) setLoad({ status: 'error', message: err instanceof SaveError ? err.code : 'internal' })
      }
    )
    return () => {
      cancelled = true
    }
  }, [api, attempt])

  const run = useCallback(async (write: (api: DataBridge) => Promise<DataResult<ChangeSet>>): Promise<ChangeSet> => {
    const current = apiRef.current
    if (!current) throw new SaveError('unavailable', 'Storage is not available')
    const changes = await unwrap(write(current))
    dispatch({ type: 'changes/apply', changes })
    return changes
  }, [])

  const commands = useMemo<WorkspaceCommands>(
    () => ({
      async captureItem(input) {
        const changes = await run((a) => a.createItem(input))
        return changes.items[0]!
      },
      async createTask(input) {
        const changes = await run((a) => a.createTask(input))
        return changes.tasks[0]!
      },
      async updateTask(id, patch) {
        await run((a) => a.updateTask(id, patch))
      },
      async setTaskStatus(id, status) {
        await run((a) => a.setTaskStatus(id, status))
      },
      async createProject(input) {
        const changes = await run((a) => a.createProject(input))
        return changes.projects[0]!
      },
      async updateItem(id, patch) {
        const changes = await run((a) => a.updateItem(id, patch))
        return changes.items.find((i) => i.id === id)!
      },
      async createDecision(input) {
        const changes = await run((a) => a.createDecision(input))
        return changes.decisions[0]!
      },
      async updateDecision(id, patch) {
        const changes = await run((a) => a.updateDecision(id, patch))
        return changes.decisions.find((d) => d.id === id)!
      },
      async setDecisionStatus(input) {
        const changes = await run((a) => a.setDecisionStatus(input))
        return changes.decisions.find((d) => d.id === input.id)!
      },
      async deleteDecision(id) {
        await run((a) => a.deleteDecision(id))
      },
      async linkDecision(input) {
        await run((a) => a.linkDecision(input))
      },
      async unlinkDecision(input) {
        await run((a) => a.unlinkDecision(input))
      },
      async createTag(label) {
        const changes = await run((a) => a.createTag({ label }))
        return changes.tags[0]!
      },
      async renameTag(id, label) {
        await run((a) => a.renameTag({ id, label }))
      },
      async deleteTag(id) {
        await run((a) => a.deleteTag(id))
      },
      async loadProjectActivity(query) {
        const current = apiRef.current
        if (!current) throw new SaveError('unavailable', 'Storage is not available')
        return unwrap(current.listProjectActivity(query))
      },
      markActivityRead() {
        setActivitySeenAt(nowRef.current().getTime())
      }
    }),
    [run]
  )

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  const value = useMemo(() => ({ data, commands, activitySeenAt }), [data, commands, activitySeenAt])
  if (load.status !== 'ready') return <>{fallback ? fallback(load, retry) : null}</>
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used inside <WorkspaceProvider>')
  return ctx
}
