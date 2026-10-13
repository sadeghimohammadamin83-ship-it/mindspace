/**
 * Registers the allowlisted data channels. Each handler checks the sender,
 * hands the raw payload to the service (which validates it), and returns a
 * DataResult envelope so the renderer gets a typed error instead of a thrown
 * string. Internal error details are logged in main, never sent to the UI.
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IpcChannel, type DataResult } from '@shared/ipc'
import { isMaintenance, MAINTENANCE_MESSAGE } from '../maintenance'
import { isTrustedSender } from '../security'
import { DataError, type WorkspaceService } from '../services/workspace-service'

export function toResult<T>(run: () => T): DataResult<T> {
  try {
    return { ok: true, value: run() }
  } catch (err) {
    if (err instanceof DataError) {
      return { ok: false, error: { code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}) } }
    }
    console.error('[data] unexpected error', err)
    return { ok: false, error: { code: 'internal', message: 'The database operation failed' } }
  }
}

type Handler = (...args: unknown[]) => unknown

/** Maps each data channel to a service call. Exported for tests. */
export function dataHandlers(service: () => WorkspaceService): Record<string, Handler> {
  const C = IpcChannel
  return {
    [C.loadWorkspace]: () => service().loadWorkspace(),
    [C.createItem]: (input) => service().createItem(input),
    [C.updateItem]: (id, patch) => service().updateItem(id, patch),
    [C.deleteItem]: (id) => service().deleteItem(id),
    [C.searchItems]: (query) => service().searchItems(query),
    [C.createProject]: (input) => service().createProject(input),
    [C.updateProject]: (id, patch) => service().updateProject(id, patch),
    [C.deleteProject]: (id) => service().deleteProject(id),
    [C.createTask]: (input) => service().createTask(input),
    [C.updateTask]: (id, patch) => service().updateTask(id, patch),
    [C.setTaskStatus]: (id, status) => service().setTaskStatus(id, status),
    [C.deleteTask]: (id) => service().deleteTask(id),
    [C.listTasks]: (filter) => service().listTasks(filter),
    [C.createDecision]: (input) => service().createDecision(input),
    [C.updateDecision]: (id, patch) => service().updateDecision(id, patch),
    [C.deleteDecision]: (id) => service().deleteDecision(id),
    [C.setDecisionStatus]: (input) => service().setDecisionStatus(input),
    [C.linkDecision]: (input) => service().linkDecision(input),
    [C.unlinkDecision]: (input) => service().unlinkDecision(input),
    [C.createTag]: (input) => service().createTag(input),
    [C.renameTag]: (input) => service().renameTag(input),
    [C.deleteTag]: (id) => service().deleteTag(id),
    [C.listProjectActivity]: (query) => service().listProjectActivity(query),
    [C.getPreferences]: () => service().getPreferences(),
    [C.setPreferences]: (patch) => service().setPreferences(patch)
  }
}

/**
 * `getService` throws a DataError('unavailable') when the database failed to
 * open, so the renderer can show its error state instead of hanging.
 */
/** Channels that only read; every other data channel may change indexed content. */
const READ_ONLY = new Set<string>([
  IpcChannel.loadWorkspace,
  IpcChannel.searchItems,
  IpcChannel.listTasks,
  IpcChannel.listProjectActivity,
  IpcChannel.getPreferences,
  IpcChannel.setPreferences
])

export function registerDataIpc(getService: () => WorkspaceService, onWrite?: () => void): void {
  for (const [channel, handler] of Object.entries(dataHandlers(getService))) {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (!isTrustedSender(event.sender, event.senderFrame?.url)) {
        return { ok: false, error: { code: 'internal', message: 'Untrusted sender' } } satisfies DataResult<never>
      }
      if (isMaintenance()) return { ok: false, error: { code: 'unavailable', message: MAINTENANCE_MESSAGE } } satisfies DataResult<never>
      // Extra arguments are never forwarded beyond what the handler declares.
      const result = toResult(() => handler(...args.slice(0, handler.length)))
      if (result.ok && !READ_ONLY.has(channel)) onWrite?.()
      return result
    })
  }
}
