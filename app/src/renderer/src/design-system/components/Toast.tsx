import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { TRANSITION } from '../motion'

export interface ToastInput {
  title: string
  description?: string
  tone?: 'success' | 'info' | 'error'
  action?: { label: string; onClick: () => void }
  durationMs?: number
}

interface ToastEntry extends ToastInput {
  id: number
}

const ToastContext = createContext<((t: ToastInput) => void) | null>(null)

/** Feedback messages for user actions, announced to screen readers. */
export function ToastProvider({ children, closeLabel }: { children: ReactNode; closeLabel: string }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([])
  const next = useRef(1)

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), [])
  const push = useCallback((t: ToastInput) => {
    const id = next.current++
    setToasts((all) => [...all.slice(-3), { ...t, id }])
  }, [])

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed end-5 bottom-5 z-[60] flex w-[min(380px,calc(100vw-2.5rem))] flex-col gap-2"
      >
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} closeLabel={closeLabel} />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}

function ToastItem({ toast, onDismiss, closeLabel }: { toast: ToastEntry; onDismiss: () => void; closeLabel: string }) {
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    if (paused) return
    const timer = setTimeout(onDismiss, toast.durationMs ?? (toast.action ? 6500 : 4200))
    return () => clearTimeout(timer)
  }, [paused, onDismiss, toast.durationMs, toast.action])

  const tone = toast.tone ?? 'success'
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'error' ? AlertCircle : Info
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98, transition: TRANSITION.fast }}
      transition={TRANSITION.base}
      role={tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="pointer-events-auto flex items-start gap-3 rounded-lg border border-line bg-raised px-3.5 py-3 shadow-lg"
    >
      <Icon
        size={17}
        strokeWidth={1.75}
        aria-hidden
        className={cn('mt-px shrink-0', tone === 'success' ? 'text-success' : tone === 'error' ? 'text-danger' : 'text-info')}
      />
      <div className="min-w-0 flex-1">
        <p className="text-base font-medium text-fg">{toast.title}</p>
        {toast.description && <p className="mt-0.5 text-sm text-fg-muted">{toast.description}</p>}
      </div>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action?.onClick()
            onDismiss()
          }}
          className="shrink-0 rounded-md px-2 py-0.5 text-sm font-medium text-accent-text hover:bg-hover"
        >
          {toast.action.label}
        </button>
      )}
      <button type="button" onClick={onDismiss} aria-label={closeLabel} className="shrink-0 rounded-sm p-0.5 text-fg-subtle hover:text-fg">
        <X size={14} aria-hidden />
      </button>
    </motion.div>
  )
}

export function useToast(): (t: ToastInput) => void {
  const push = useContext(ToastContext)
  if (!push) throw new Error('useToast must be used inside <ToastProvider>')
  return useMemo(() => push, [push])
}
