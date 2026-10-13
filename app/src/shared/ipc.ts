/**
 * IPC channel names and the typed bridge shared by main and preload. Every
 * channel the renderer can reach is listed here; each data channel is a named
 * operation whose payload the main process validates (see contracts.ts).
 * There is deliberately no channel that accepts SQL or a file path.
 */
import type {
  ActivityQuery,
  DecisionCreateInput,
  DecisionLinkInput,
  DecisionPatch,
  DecisionStatusInput,
  ItemCreateInput,
  ItemPatch,
  ItemSearch,
  ProjectCreateInput,
  ProjectPatch,
  StoredPreferences,
  TaskCreateInput,
  TaskFilter,
  TaskPatchInput
} from './contracts'
import type { AiBridge } from './ai'
import type { BackupBridge } from './backup'
import type { DocumentsBridge } from './documents'
import type { RetrievalBridge } from './retrieval'
import type { ActivityEvent, Decision, Id, KnowledgeItem, Project, Tag, Task, TaskStatus } from './domain'

export const IpcChannel = {
  getAppInfo: 'app:get-info',
  loadWorkspace: 'data:load-workspace',
  createItem: 'data:item-create',
  updateItem: 'data:item-update',
  deleteItem: 'data:item-delete',
  searchItems: 'data:item-search',
  createProject: 'data:project-create',
  updateProject: 'data:project-update',
  deleteProject: 'data:project-delete',
  createTask: 'data:task-create',
  updateTask: 'data:task-update',
  setTaskStatus: 'data:task-set-status',
  deleteTask: 'data:task-delete',
  listTasks: 'data:task-list',
  createDecision: 'data:decision-create',
  updateDecision: 'data:decision-update',
  deleteDecision: 'data:decision-delete',
  setDecisionStatus: 'data:decision-set-status',
  linkDecision: 'data:decision-link',
  unlinkDecision: 'data:decision-unlink',
  createTag: 'data:tag-create',
  renameTag: 'data:tag-rename',
  deleteTag: 'data:tag-delete',
  listProjectActivity: 'data:project-activity',
  getPreferences: 'prefs:get',
  importDocuments: 'docs:import',
  listDocuments: 'docs:list',
  getDocument: 'docs:get',
  getDocumentPage: 'docs:get-page',
  reprocessDocument: 'docs:reprocess',
  removeDocument: 'docs:remove',
  rebuildSearchIndex: 'search:rebuild',
  search: 'search:run',
  semanticStatus: 'semantic:status',
  semanticSetup: 'semantic:setup',
  semanticRebuild: 'semantic:rebuild',
  retrieve: 'retrieve:run',
  aiGetSettings: 'ai:settings-get',
  aiUpdateSettings: 'ai:settings-update',
  aiSaveKey: 'ai:key-save',
  aiRemoveKey: 'ai:key-remove',
  aiTest: 'ai:test',
  aiAsk: 'ai:ask',
  aiCancel: 'ai:cancel',
  aiListConversations: 'ai:conversations',
  aiGetConversation: 'ai:conversation-get',
  aiDeleteConversation: 'ai:conversation-delete',
  /** Main → renderer push channel for generation events. */
  aiEvent: 'ai:event',
  backupStatus: 'backup:status',
  backupConfig: 'backup:config',
  backupCreate: 'backup:create',
  backupCreateAuto: 'backup:create-auto',
  backupChooseDestination: 'backup:choose-destination',
  backupResetDestination: 'backup:reset-destination',
  backupSelect: 'backup:select',
  backupInspect: 'backup:inspect',
  backupVerifyRecord: 'backup:verify-record',
  backupRestore: 'backup:restore',
  backupForget: 'backup:forget',
  backupDismissRestore: 'backup:dismiss-restore',
  /** Main → renderer push channel for backup progress. */
  backupEvent: 'backup:event',
  setPreferences: 'prefs:set'
} as const

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  isPackaged: boolean
}

/** Everything persistent the UI shows, loaded once at start-up. */
export interface WorkspaceSnapshot {
  tags: Tag[]
  projects: Project[]
  items: KnowledgeItem[]
  tasks: Task[]
  decisions: Decision[]
  activity: ActivityEvent[]
}

/**
 * What a write changed. The renderer cache applies it as-is, so every screen
 * reflects exactly what was committed to the database.
 */
export interface ChangeSet {
  tags: Tag[]
  projects: Project[]
  items: KnowledgeItem[]
  tasks: Task[]
  decisions: Decision[]
  activity: ActivityEvent[]
  removed: { type: 'item' | 'task' | 'project' | 'decision' | 'tag'; id: Id }[]
}

export type DataErrorCode = 'validation' | 'not_found' | 'conflict' | 'unavailable' | 'internal'

export type DataResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: DataErrorCode; message: string; fields?: Record<string, string> } }

/** Persistent data operations. Each maps to exactly one allowlisted channel. */
export interface DataBridge {
  loadWorkspace(): Promise<DataResult<WorkspaceSnapshot>>
  createItem(input: ItemCreateInput): Promise<DataResult<ChangeSet>>
  updateItem(id: Id, patch: ItemPatch): Promise<DataResult<ChangeSet>>
  deleteItem(id: Id): Promise<DataResult<ChangeSet>>
  searchItems(query: ItemSearch): Promise<DataResult<KnowledgeItem[]>>
  createProject(input: ProjectCreateInput): Promise<DataResult<ChangeSet>>
  updateProject(id: Id, patch: ProjectPatch): Promise<DataResult<ChangeSet>>
  deleteProject(id: Id): Promise<DataResult<ChangeSet>>
  createTask(input: TaskCreateInput): Promise<DataResult<ChangeSet>>
  updateTask(id: Id, patch: TaskPatchInput): Promise<DataResult<ChangeSet>>
  setTaskStatus(id: Id, status: TaskStatus): Promise<DataResult<ChangeSet>>
  deleteTask(id: Id): Promise<DataResult<ChangeSet>>
  listTasks(filter: TaskFilter): Promise<DataResult<Task[]>>
  createDecision(input: DecisionCreateInput): Promise<DataResult<ChangeSet>>
  updateDecision(id: Id, patch: DecisionPatch): Promise<DataResult<ChangeSet>>
  deleteDecision(id: Id): Promise<DataResult<ChangeSet>>
  setDecisionStatus(input: DecisionStatusInput): Promise<DataResult<ChangeSet>>
  linkDecision(input: DecisionLinkInput): Promise<DataResult<ChangeSet>>
  unlinkDecision(input: DecisionLinkInput): Promise<DataResult<ChangeSet>>
  createTag(input: { label: string }): Promise<DataResult<ChangeSet>>
  renameTag(input: { id: Id; label: string }): Promise<DataResult<ChangeSet>>
  deleteTag(id: Id): Promise<DataResult<ChangeSet>>
  listProjectActivity(query: ActivityQuery): Promise<DataResult<ActivityEvent[]>>
  getPreferences(): Promise<DataResult<Partial<StoredPreferences>>>
  setPreferences(patch: Partial<StoredPreferences>): Promise<DataResult<null>>
}

/** The complete surface the preload script exposes on `window.mindspace`. */
export interface MindspaceBridge {
  getAppInfo(): Promise<AppInfo>
  data: DataBridge
  documents: DocumentsBridge
  retrieval: RetrievalBridge
  ai: AiBridge
  backup: BackupBridge
}
