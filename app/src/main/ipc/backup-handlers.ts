/**
 * Allowlisted backup channels. Same rules as the other handlers: trusted
 * sender only, payloads validated with zod (strict objects, so unknown keys
 * are refused), results in the DataResult envelope with BackupError messages
 * only. No channel accepts a file path: dialogs open in this process and
 * selections are returned as opaque tokens.
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IpcChannel, type DataResult } from '@shared/ipc'
import { configPatchSchema, createSchema, inspectSchema, recordIdSchema, restoreSchema, selectSchema, verifyRecordSchema } from '@shared/backup-contracts'
import { BackupError, toBackupError } from '../backup/errors'
import type { BackupService } from '../backup/service'
import { isTrustedSender } from '../security'

type Handler = (...args: unknown[]) => unknown

function parse<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } }, value: unknown): T {
  const r = schema.safeParse(value ?? {})
  if (!r.success) throw new BackupError('invalid_request', 'The request was not valid.')
  return r.data
}

export function backupHandlers(service: () => BackupService): Record<string, Handler> {
  const C = IpcChannel
  return {
    [C.backupStatus]: () => service().getStatus(),
    [C.backupConfig]: (patch) => service().setConfig(parse(configPatchSchema, patch)),
    [C.backupCreate]: (input) => service().create(parse(createSchema, input)),
    [C.backupCreateAuto]: () => service().createAutoNow(),
    [C.backupChooseDestination]: () => service().chooseDestination(),
    [C.backupResetDestination]: () => service().resetDestination(),
    [C.backupSelect]: (input) => service().select(parse(selectSchema, input)),
    [C.backupInspect]: (input) => service().inspect(parse(inspectSchema, input)),
    [C.backupVerifyRecord]: (input) => service().verifyRecord(parse(verifyRecordSchema, input)),
    [C.backupRestore]: (input) => service().restore(parse(restoreSchema, input)),
    [C.backupForget]: (id) => service().forget(parse(recordIdSchema, id)),
    [C.backupDismissRestore]: () => service().dismissLastRestore()
  }
}

export async function backupResult<T>(run: () => T | Promise<T>): Promise<DataResult<Awaited<T>>> {
  try {
    return { ok: true, value: await run() }
  } catch (err) {
    const e = err instanceof BackupError ? err : toBackupError(err)
    if (!(err instanceof BackupError)) console.error('[backup] unexpected failure', (err as NodeJS.ErrnoException)?.code ?? 'error')
    return { ok: false, error: { code: e.code === 'invalid_request' ? 'validation' : e.code === 'unavailable' ? 'unavailable' : 'internal', message: e.message, fields: { backup: e.code } } }
  }
}

export function registerBackupIpc(getService: () => BackupService): void {
  for (const [channel, handler] of Object.entries(backupHandlers(getService))) {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (!isTrustedSender(event.sender, event.senderFrame?.url)) {
        return { ok: false, error: { code: 'internal', message: 'Untrusted sender' } } satisfies DataResult<never>
      }
      return backupResult(() => handler(...args.slice(0, Math.max(1, handler.length))))
    })
  }
}
