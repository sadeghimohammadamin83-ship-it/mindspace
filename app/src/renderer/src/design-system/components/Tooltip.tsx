import type { ReactElement, ReactNode } from 'react'
import { Tooltip as T } from 'radix-ui'

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <T.Provider delayDuration={450} skipDelayDuration={200}>
      {children}
    </T.Provider>
  )
}

/**
 * Wraps a single focusable child. Extra props (from a parent `asChild`
 * trigger such as a menu or popover) are forwarded to that child.
 */
export function Tooltip({
  content,
  children,
  side = 'bottom',
  ...forwarded
}: {
  content: ReactNode
  children: ReactElement
  side?: 'top' | 'bottom' | 'left' | 'right'
} & Record<string, unknown>) {
  return (
    <T.Root>
      <T.Trigger asChild {...forwarded}>
        {children}
      </T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="z-50 max-w-72 animate-fade-in data-[state=closed]:animate-fade-out rounded-md border border-line bg-raised px-2.5 py-1.5 text-xs text-fg shadow-md"
        >
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  )
}
