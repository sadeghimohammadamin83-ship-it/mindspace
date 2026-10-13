import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DataBridge } from '@shared/ipc'
import { IpcChannel } from '@shared/ipc'
import { dataHandlers, toResult } from '../../../src/main/ipc/data-handlers'
import { documentHandlers, toResultAsync } from '../../../src/main/ipc/document-handlers'
import type { DocumentService } from '../../../src/main/services/document-service'
import type { DocumentsBridge } from '@shared/documents'
import type { WorkspaceService } from '../../../src/main/services/workspace-service'
import { semanticHandlers } from '../../../src/main/ipc/semantic-handlers'
import type { SemanticService } from '../../../src/main/semantic/semantic-service'
import type { RetrievalBridge } from '@shared/retrieval'

/** A throwaway folder under the OS temp dir. Never the user's real profile. */
export function tempDir(): { dir: string; file: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'mindspace-test-'))
  return { dir, file: join(dir, 'mindspace.sqlite3'), cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/**
 * The renderer's DataBridge, wired to the real main-process handlers the same
 * way ipcMain does it, with structured cloning standing in for IPC.
 */
export function bridgeFor(service: () => WorkspaceService): DataBridge {
  const handlers = dataHandlers(service)
  const call = (channel: string, ...args: unknown[]) => {
    const handler = handlers[channel]!
    return Promise.resolve(structuredClone(toResult(() => handler(...structuredClone(args).slice(0, handler.length)))))
  }
  const C = IpcChannel
  return {
    loadWorkspace: () => call(C.loadWorkspace),
    createItem: (i) => call(C.createItem, i),
    updateItem: (id, p) => call(C.updateItem, id, p),
    deleteItem: (id) => call(C.deleteItem, id),
    searchItems: (q) => call(C.searchItems, q),
    createProject: (i) => call(C.createProject, i),
    updateProject: (id, p) => call(C.updateProject, id, p),
    deleteProject: (id) => call(C.deleteProject, id),
    createTask: (i) => call(C.createTask, i),
    updateTask: (id, p) => call(C.updateTask, id, p),
    setTaskStatus: (id, s) => call(C.setTaskStatus, id, s),
    deleteTask: (id) => call(C.deleteTask, id),
    listTasks: (f) => call(C.listTasks, f),
    createDecision: (i) => call(C.createDecision, i),
    updateDecision: (id, p) => call(C.updateDecision, id, p),
    deleteDecision: (id) => call(C.deleteDecision, id),
    setDecisionStatus: (i) => call(C.setDecisionStatus, i),
    linkDecision: (i) => call(C.linkDecision, i),
    unlinkDecision: (i) => call(C.unlinkDecision, i),
    createTag: (i) => call(C.createTag, i),
    renameTag: (i) => call(C.renameTag, i),
    deleteTag: (id) => call(C.deleteTag, id),
    listProjectActivity: (q) => call(C.listProjectActivity, q),
    getPreferences: () => call(C.getPreferences),
    setPreferences: (p) => call(C.setPreferences, p)
  } as DataBridge
}

/** The renderer's DocumentsBridge wired to the real document handlers (structured clone stands in for IPC). */
export function documentsBridgeFor(service: () => DocumentService): DocumentsBridge {
  const handlers = documentHandlers(service)
  const call = async (channel: string, ...args: unknown[]) => {
    const handler = handlers[channel]!
    return structuredClone(await toResultAsync(() => handler(...structuredClone(args).slice(0, handler.length))))
  }
  const C = IpcChannel
  return {
    importDocuments: () => call(C.importDocuments),
    list: () => call(C.listDocuments),
    get: (id) => call(C.getDocument, id),
    getPage: (r) => call(C.getDocumentPage, r),
    reprocess: (id) => call(C.reprocessDocument, id),
    remove: (id) => call(C.removeDocument, id),
    rebuildIndex: () => call(C.rebuildSearchIndex),
    search: (q) => call(C.search, q)
  } as DocumentsBridge
}

/** The renderer's RetrievalBridge wired to the real semantic handlers (structured clone stands in for IPC). */
export function retrievalBridgeFor(service: () => SemanticService): RetrievalBridge {
  const handlers = semanticHandlers(service)
  const call = async (channel: string, ...args: unknown[]) => {
    const handler = handlers[channel]!
    return structuredClone(await toResultAsync(() => handler(...structuredClone(args).slice(0, handler.length))))
  }
  const C = IpcChannel
  return {
    status: () => call(C.semanticStatus),
    setupModel: () => call(C.semanticSetup),
    rebuildIndex: () => call(C.semanticRebuild),
    retrieve: (q) => call(C.retrieve, q)
  } as RetrievalBridge
}
