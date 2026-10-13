import { AlertCircle } from 'lucide-react'
import { Button } from '@/design-system/components'
import { useI18n } from '@/state/preferences'
import type { LoadState } from '@/state/workspace'
import { RecoveryRestore } from '@/features/settings/BackupPanel'
import { defaultBackupApi } from '@/state/backup'
import { LogoMark } from './Logo'

/** Full-window state shown while the database loads, or if it cannot be opened. */
export function WorkspaceStatus({ state, onRetry }: { state: LoadState; onRetry: () => void }) {
  const { t } = useI18n()
  return (
    <main className="flex h-screen flex-col items-center justify-center gap-4 bg-canvas px-6 text-center">
      <LogoMark size={32} />
      {state.status === 'error' ? (
        <div role="alert" className="flex max-w-md flex-col items-center gap-3">
          <AlertCircle size={22} className="text-danger" aria-hidden />
          <h1 className="text-lg font-semibold text-fg">{t.app.storageErrorTitle}</h1>
          <p className="text-sm text-fg-muted">
            {state.message === 'unavailable' && !window.mindspace ? t.app.storageUnavailable : t.app.storageErrorBody}
          </p>
          {window.mindspace ? <Button onClick={onRetry}>{t.common.retry}</Button> : null}
          {window.mindspace && defaultBackupApi() ? <RecoveryRestore api={defaultBackupApi()!} /> : null}
        </div>
      ) : (
        <p role="status" className="text-sm text-fg-muted">
          {t.common.loading}
        </p>
      )}
    </main>
  )
}
