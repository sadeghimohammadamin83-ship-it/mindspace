/**
 * Allowlisted document and search channels. Same rules as data-handlers:
 * sender check, payload validated by the service, DataResult envelope, no
 * internal details to the UI. `docs:import` takes no argument at all, so a
 * renderer can never name a file path.
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IpcChannel, type DataResult } from '@shared/ipc'
import { isMaintenance, MAINTENANCE_MESSAGE } from '../maintenance'
import { isTrustedSender } from '../security'
import type { DocumentService } from '../services/document-service'
import { toResult } from './data-handlers'

type Handler = (...args: unknown[]) => unknown

export function documentHandlers(service: () => DocumentService): Record<string, Handler> {
  const C = IpcChannel
  return {
    [C.importDocuments]: () => service().importDocuments(),
    [C.listDocuments]: () => service().list(),
    [C.getDocument]: (id) => service().get(id),
    [C.getDocumentPage]: (req) => service().getPage(req),
    [C.reprocessDocument]: (id) => service().reprocess(id),
    [C.removeDocument]: (id) => service().remove(id),
    [C.rebuildSearchIndex]: () => service().rebuildIndex(),
    [C.search]: (query) => service().search(query)
  }
}

/** Like toResult, for handlers that may return a promise. */
export async function toResultAsync<T>(run: () => T | Promise<T>): Promise<DataResult<Awaited<T>>> {
  let value: Awaited<T>
  try {
    value = await run()
  } catch (err) {
    return toResult(() => {
      throw err
    })
  }
  return { ok: true, value }
}

export function registerDocumentIpc(getService: () => DocumentService): void {
  for (const [channel, handler] of Object.entries(documentHandlers(getService))) {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (!isTrustedSender(event.sender, event.senderFrame?.url)) {
        return { ok: false, error: { code: 'internal', message: 'Untrusted sender' } } satisfies DataResult<never>
      }
      if (isMaintenance()) return { ok: false, error: { code: 'unavailable', message: MAINTENANCE_MESSAGE } } satisfies DataResult<never>
      return toResultAsync(() => handler(...args.slice(0, handler.length)))
    })
  }
}
