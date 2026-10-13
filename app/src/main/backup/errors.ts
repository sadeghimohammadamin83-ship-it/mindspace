import type { BackupErrorCode } from '@shared/backup'

/** A failure with a code and a message safe to show: no paths, no stack, no secrets. */
export class BackupError extends Error {
  constructor(
    readonly code: BackupErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'BackupError'
  }
}

/** Maps filesystem errors to codes the UI can explain. Unknown errors become `internal` with a generic message. */
export function toBackupError(err: unknown): BackupError {
  if (err instanceof BackupError) return err
  const code = (err as NodeJS.ErrnoException | null)?.code
  switch (code) {
    case 'ENOSPC':
    case 'EDQUOT':
      return new BackupError('disk_full', 'There is not enough free disk space.')
    case 'EACCES':
    case 'EPERM':
    case 'EROFS':
      return new BackupError('permission', 'Windows denied access to the file or folder.')
    case 'EBUSY':
    case 'ETXTBSY':
      return new BackupError('locked', 'A file is in use by another program. Close it and try again.')
    case 'ENOENT':
    case 'ENOTDIR':
    case 'ENODEV':
    case 'ENXIO':
      return new BackupError('destination_unavailable', 'The folder or drive is not available.')
    default:
      return new BackupError('internal', 'The operation failed unexpectedly. Your data was not changed.')
  }
}
