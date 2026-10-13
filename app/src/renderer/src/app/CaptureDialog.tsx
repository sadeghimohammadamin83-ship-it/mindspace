import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Id } from '@shared/domain'
import { Dialog } from '@/design-system/components'
import { CaptureForm, type CaptureKind } from '@/features/shared/CaptureForm'
import { useI18n } from '@/state/preferences'

interface CaptureOptions {
  kind?: CaptureKind
  projectId?: Id | null
}

const CaptureContext = createContext<((opts?: CaptureOptions) => void) | null>(null)

/** Hosts the Quick Capture dialog so any screen (or Ctrl+Shift+Space) can open it. */
export function CaptureDialogProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const [state, setState] = useState<{ open: boolean; opts: CaptureOptions; key: number }>({ open: false, opts: {}, key: 0 })
  const open = useCallback((opts: CaptureOptions = {}) => setState((s) => ({ open: true, opts, key: s.key + 1 })), [])
  const close = useCallback(() => setState((s) => ({ ...s, open: false })), [])
  const value = useMemo(() => open, [open])

  return (
    <CaptureContext.Provider value={value}>
      {children}
      <Dialog open={state.open} onOpenChange={(o) => !o && close()} title={t.capture.dialogTitle} description={t.capture.description} width="lg">
        <CaptureForm
          key={state.key}
          {...(state.opts.kind ? { initialKind: state.opts.kind } : {})}
          initialProjectId={state.opts.projectId ?? null}
          onCancel={close}
          onSaved={close}
        />
      </Dialog>
    </CaptureContext.Provider>
  )
}

export function useCaptureDialog(): (opts?: CaptureOptions) => void {
  const open = useContext(CaptureContext)
  if (!open) throw new Error('useCaptureDialog must be used inside <CaptureDialogProvider>')
  return open
}
