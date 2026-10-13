import type { ReactNode } from 'react'
import { Tabs as T } from 'radix-ui'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface TabItem<V extends string> {
  value: V
  label: string
  icon?: LucideIcon
  /** Small count shown after the label. */
  count?: string
}

/**
 * Section tabs (WAI-ARIA tabs: arrow keys move focus, panels are labelled by
 * their tab). The selected tab is marked with an amber underline.
 */
export function Tabs<V extends string>({
  value,
  onValueChange,
  tabs,
  label,
  children
}: {
  value: V
  onValueChange: (value: V) => void
  tabs: Array<TabItem<V>>
  label: string
  children: ReactNode
}) {
  return (
    <T.Root value={value} onValueChange={(v) => onValueChange(v as V)}>
      <T.List aria-label={label} className="mb-5 flex flex-wrap gap-1 border-b border-line-subtle">
        {tabs.map(({ value: v, label: l, icon: Icon, count }) => (
          <T.Trigger
            key={v}
            value={v}
            className={cn(
              'relative -mb-px inline-flex h-9 shrink-0 items-center gap-1.5 border-b-2 border-transparent px-3 text-sm font-medium text-fg-muted transition-colors',
              'hover:text-fg data-[state=active]:border-accent data-[state=active]:text-fg'
            )}
          >
            {Icon && <Icon size={14} strokeWidth={1.75} aria-hidden />}
            {l}
            {count !== undefined && <span className="num text-xs font-normal text-fg-subtle">{count}</span>}
          </T.Trigger>
        ))}
      </T.List>
      {children}
    </T.Root>
  )
}

export function TabPanel({ value, children }: { value: string; children: ReactNode }) {
  return (
    <T.Content value={value} className="outline-none focus-visible:outline-accent/50">
      {children}
    </T.Content>
  )
}
