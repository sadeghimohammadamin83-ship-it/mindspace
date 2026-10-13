import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannel, type DataBridge, type MindspaceBridge } from '@shared/ipc'
import type { DocumentsBridge } from '@shared/documents'
import type { RetrievalBridge } from '@shared/retrieval'
import type { AiBridge, AiEvent } from '@shared/ai'
import type { BackupBridge, BackupProgress } from '@shared/backup'

/**
 * The only API the renderer gets. Named methods, no raw ipcRenderer, no Node,
 * no SQL: each method invokes one fixed channel, and main validates the payload.
 */
const C = IpcChannel
const call = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

const data: DataBridge = {
  loadWorkspace: () => call(C.loadWorkspace),
  createItem: (input) => call(C.createItem, input),
  updateItem: (id, patch) => call(C.updateItem, id, patch),
  deleteItem: (id) => call(C.deleteItem, id),
  searchItems: (query) => call(C.searchItems, query),
  createProject: (input) => call(C.createProject, input),
  updateProject: (id, patch) => call(C.updateProject, id, patch),
  deleteProject: (id) => call(C.deleteProject, id),
  createTask: (input) => call(C.createTask, input),
  updateTask: (id, patch) => call(C.updateTask, id, patch),
  setTaskStatus: (id, status) => call(C.setTaskStatus, id, status),
  deleteTask: (id) => call(C.deleteTask, id),
  listTasks: (filter) => call(C.listTasks, filter),
  createDecision: (input) => call(C.createDecision, input),
  updateDecision: (id, patch) => call(C.updateDecision, id, patch),
  deleteDecision: (id) => call(C.deleteDecision, id),
  setDecisionStatus: (input) => call(C.setDecisionStatus, input),
  linkDecision: (input) => call(C.linkDecision, input),
  unlinkDecision: (input) => call(C.unlinkDecision, input),
  createTag: (input) => call(C.createTag, input),
  renameTag: (input) => call(C.renameTag, input),
  deleteTag: (id) => call(C.deleteTag, id),
  listProjectActivity: (query) => call(C.listProjectActivity, query),
  getPreferences: () => call(C.getPreferences),
  setPreferences: (patch) => call(C.setPreferences, patch)
}

// No method takes a file path: importing opens the native dialog in main.
const documents: DocumentsBridge = {
  importDocuments: () => call(C.importDocuments),
  list: () => call(C.listDocuments),
  get: (id) => call(C.getDocument, id),
  getPage: (req) => call(C.getDocumentPage, req),
  reprocess: (id) => call(C.reprocessDocument, id),
  remove: (id) => call(C.removeDocument, id),
  rebuildIndex: () => call(C.rebuildSearchIndex),
  search: (query) => call(C.search, query)
}

// Retrieval: queries go to main, which embeds them locally; no channel accepts vectors, SQL or paths.
const retrieval: RetrievalBridge = {
  status: () => call(C.semanticStatus),
  setupModel: () => call(C.semanticSetup),
  rebuildIndex: () => call(C.semanticRebuild),
  retrieve: (query) => call(C.retrieve, query)
}

// AI: the renderer can ask, cancel and read history. There is no method that returns an API key,
// accepts a URL, a prompt or a source path; generation events are pushed from main.
const ai: AiBridge = {
  getSettings: () => call(C.aiGetSettings),
  updateSettings: (patch) => call(C.aiUpdateSettings, patch),
  saveKey: (input) => call(C.aiSaveKey, input),
  removeKey: (provider) => call(C.aiRemoveKey, provider),
  testConnection: (provider) => call(C.aiTest, provider),
  ask: (req) => call(C.aiAsk, req),
  cancel: (id) => call(C.aiCancel, id),
  listConversations: () => call(C.aiListConversations),
  getConversation: (id) => call(C.aiGetConversation, id),
  deleteConversation: (id) => call(C.aiDeleteConversation, id),
  onEvent(listener) {
    // Only the payload is forwarded, never the IPC event object.
    const handler = (_event: unknown, payload: AiEvent) => listener(payload)
    ipcRenderer.on(C.aiEvent, handler)
    return () => void ipcRenderer.removeListener(C.aiEvent, handler)
  }
}

// Backup: no method takes a path. Dialogs open in main; passwords go to main once and are never returned.
const backup: BackupBridge = {
  getStatus: () => call(C.backupStatus),
  setConfig: (patch) => call(C.backupConfig, patch),
  create: (input) => call(C.backupCreate, input),
  createAutoNow: () => call(C.backupCreateAuto),
  chooseDestination: () => call(C.backupChooseDestination),
  resetDestination: () => call(C.backupResetDestination),
  select: (input) => call(C.backupSelect, input),
  inspect: (input) => call(C.backupInspect, input),
  verifyRecord: (input) => call(C.backupVerifyRecord, input),
  restore: (input) => call(C.backupRestore, input),
  forget: (id) => call(C.backupForget, id),
  dismissLastRestore: () => call(C.backupDismissRestore),
  onEvent(listener) {
    const handler = (_event: unknown, payload: BackupProgress) => listener(payload)
    ipcRenderer.on(C.backupEvent, handler)
    return () => void ipcRenderer.removeListener(C.backupEvent, handler)
  }
}

const bridge: MindspaceBridge = {
  getAppInfo: () => ipcRenderer.invoke(IpcChannel.getAppInfo),
  data: Object.freeze(data),
  documents: Object.freeze(documents),
  retrieval: Object.freeze(retrieval),
  ai: Object.freeze(ai),
  backup: Object.freeze(backup)
}

contextBridge.exposeInMainWorld('mindspace', bridge)
