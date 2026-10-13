import type { ReactNode } from 'react'
import { Dialog as D } from 'radix-ui'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useI18n } from '@/state/preferences'
import { IconButton } from './Button'

interface OverlayProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  /** Extra elements in the header, before the close button. */
  headerExtra?: ReactNode
}

/** Centered modal dialog. Escape, the close button and the scrim all close it. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  headerExtra,
  width = 'md'
}: OverlayProps & { width?: 'sm' | 'md' | 'lg' }) {
  const { t } = useI18n()
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 animate-fade-in bg-scrim data-[state=closed]:animate-fade-out" />
        <D.Content
          className={cn(
            'fixed left-1/2 top-[12vh] z-50 data-[state=closed]:animate-fade-out flex max-h-[80vh] w-[calc(100vw-2rem)] -translate-x-1/2 flex-col rounded-xl border border-line bg-surface shadow-lg',
            width === 'sm' ? 'max-w-md' : width === 'md' ? 'max-w-xl' : 'max-w-2xl'
          )}
        >
          <div className="animate-pop-in flex min-h-0 flex-1 flex-col">
            <header className="flex items-start gap-3 px-5 pt-4 pb-3">
              <div className="min-w-0 flex-1">
                <D.Title className="text-lg font-semibold text-fg">{title}</D.Title>
                {description ? (
                  <D.Description className="mt-0.5 text-sm text-fg-muted">{description}</D.Description>
                ) : (
                  <D.Description className="sr-only">{title}</D.Description>
                )}
              </div>
              {headerExtra}
              <D.Close asChild>
                <IconButton icon={X} label={t.common.close} size="sm" tooltip={false} />
              </D.Close>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
            {footer && (
              <footer className="flex items-center justify-end gap-2 border-t border-line-subtle px-5 py-3">{footer}</footer>
            )}
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}

/** Side sheet anchored to the inline end of the window. */
export function Drawer({ open, onOpenChange, title, description, children, footer, headerExtra }: OverlayProps) {
  const { t } = useI18n()
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 animate-fade-in bg-scrim data-[state=closed]:animate-fade-out" />
        <D.Content className="fixed inset-y-0 end-0 z-50 flex w-[min(560px,92vw)] animate-sheet-in data-[state=closed]:animate-sheet-out flex-col border-s border-line bg-surface shadow-lg [--sheet-from:24px] rtl:[--sheet-from:-24px]">
          <header className="flex items-start gap-3 border-b border-line-subtle px-6 py-4">
            <div className="min-w-0 flex-1">
              <D.Title className="text-lg font-semibold text-fg" dir="auto">
                {title}
              </D.Title>
              {description ? (
                <D.Description className="mt-1 text-sm text-fg-muted">{description}</D.Description>
              ) : (
                <D.Description className="sr-only">{title}</D.Description>
              )}
            </div>
            {headerExtra}
            <D.Close asChild>
              <IconButton icon={X} label={t.common.close} size="sm" tooltip={false} />
            </D.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
          {footer && <footer className="flex items-center gap-2 border-t border-line-subtle px-6 py-3">{footer}</footer>}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
