/**
 * Allowlisted retrieval channels. Same rules as the other handlers: sender
 * check, payload validated by the service (zod), DataResult envelope, no
 * internal details to the UI. Model setup takes no argument: the renderer
 * cannot choose a URL, a file or a model.
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IpcChannel, type DataResult } from '@shared/ipc'
import { isMaintenance, MAINTENANCE_MESSAGE } from '../maintenance'
import { isTrustedSender } from '../security'
import type { SemanticService } from '../semantic/semantic-service'
import { toResultAsync } from './document-handlers'

type Handler = (...args: unknown[]) => unknown

export function semanticHandlers(service: () => SemanticService): Record<string, Handler> {
  const C = IpcChannel
  return {
    [C.semanticStatus]: () => service().status(),
    [C.semanticSetup]: () => service().setupModel(),
    [C.semanticRebuild]: () => service().rebuildIndex(),
    [C.retrieve]: (query) => service().retrieve(query)
  }
}

export function registerSemanticIpc(getService: () => SemanticService): void {
  for (const [channel, handler] of Object.entries(semanticHandlers(getService))) {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (!isTrustedSender(event.sender, event.senderFrame?.url)) {
        return { ok: false, error: { code: 'internal', message: 'Untrusted sender' } } satisfies DataResult<never>
      }
      if (isMaintenance()) return { ok: false, error: { code: 'unavailable', message: MAINTENANCE_MESSAGE } } satisfies DataResult<never>
      return toResultAsync(() => handler(...args.slice(0, handler.length)))
    })
  }
}
