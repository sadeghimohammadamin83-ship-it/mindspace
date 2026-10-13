/**
 * AI channels. Same rules as the other handlers (trusted sender, zod
 * validation in the services, DataResult envelope). Specific to AI:
 *  - no channel returns an API key; `ai:key-save` takes one and returns only
 *    metadata (configured / updated-at);
 *  - no channel accepts a URL (other than the loopback Ollama address, which
 *    the settings service validates), a prompt, a source path or SQL;
 *  - generation events are pushed to the window that asked.
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IpcChannel, type DataResult } from '@shared/ipc'
import type { AiEvent } from '@shared/ai'
import { cloudProviderSchema, saveKeySchema } from '@shared/ai-contracts'
import { isMaintenance, MAINTENANCE_MESSAGE } from '../maintenance'
import { isTrustedSender } from '../security'
import { DataError } from '../services/workspace-service'
import { CredentialError } from '../ai/credentials'
import type { AiServices } from '../ai/ai-services'
import { toResultAsync } from './document-handlers'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

export function aiHandlers(getServices: () => Promise<AiServices>, push: (event: IpcMainInvokeEvent, e: AiEvent) => void): Record<string, Handler> {
  const C = IpcChannel
  return {
    [C.aiGetSettings]: async () => (await getServices()).settings.view(),
    [C.aiUpdateSettings]: async (_e, patch) => (await getServices()).settings.update(patch),
    [C.aiSaveKey]: async (_e, input) => {
      const s = await getServices()
      const r = saveKeySchema.safeParse(input)
      if (!r.success) throw new DataError('validation', 'Invalid key')
      try {
        await s.credentials.save(r.data.provider, r.data.key)
      } catch (err) {
        if (err instanceof CredentialError) throw new DataError('unavailable', err.message, { ai: err.code })
        throw err
      }
      return s.settings.view()
    },
    [C.aiRemoveKey]: async (_e, provider) => {
      const s = await getServices()
      const r = cloudProviderSchema.safeParse(provider)
      if (!r.success) throw new DataError('validation', 'Invalid provider')
      await s.credentials.remove(r.data)
      return s.settings.view()
    },
    [C.aiTest]: async (_e, provider) => (await getServices()).answers.testConnection(provider),
    [C.aiAsk]: async (event, req) => (await getServices()).answers.ask(req, (e) => push(event, e)),
    [C.aiCancel]: async (_e, id) => {
      ;(await getServices()).answers.cancel(id)
      return null
    },
    [C.aiListConversations]: async () => (await getServices()).answers.listConversations(),
    [C.aiGetConversation]: async (_e, id) => (await getServices()).answers.getConversation(id),
    [C.aiDeleteConversation]: async (_e, id) => (await getServices()).answers.deleteConversation(id)
  }
}

export function registerAiIpc(getServices: () => Promise<AiServices>): void {
  const push = (event: IpcMainInvokeEvent, e: AiEvent) => {
    if (!event.sender.isDestroyed()) event.sender.send(IpcChannel.aiEvent, e)
  }
  for (const [channel, handler] of Object.entries(aiHandlers(getServices, push))) {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (!isTrustedSender(event.sender, event.senderFrame?.url)) {
        return { ok: false, error: { code: 'internal', message: 'Untrusted sender' } } satisfies DataResult<never>
      }
      if (isMaintenance()) return { ok: false, error: { code: 'unavailable', message: MAINTENANCE_MESSAGE } } satisfies DataResult<never>
      // At most one argument is ever used by these channels.
      return toResultAsync(() => handler(event, ...args.slice(0, 1)))
    })
  }
}
