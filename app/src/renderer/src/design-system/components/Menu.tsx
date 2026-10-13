import type { ReactElement, ReactNode } from 'react'
import { DropdownMenu as M, Popover as P } from 'radix-ui'
import type { LucideIcon } from 'lucide-react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/cn'

const panel = 'z-50 animate-pop-in data-[state=closed]:animate-pop-out rounded-lg border border-line bg-raised p-1 shadow-lg'
const itemClass =
  'relative flex h-8 cursor-default items-center gap-2.5 rounded-md px-2.5 text-base text-fg outline-none select-none data-disabled:text-fg-disabled data-highlighted:bg-hover'

export function Menu({
  trigger,
  children,
  align = 'end',
  side = 'bottom',
  label
}: {
  trigger: ReactElement
  children: ReactNode
  align?: 'start' | 'end' | 'center'
  side?: 'top' | 'bottom'
  label?: string
}) {
  return (
    <M.Root>
      <M.Trigger asChild>{trigger}</M.Trigger>
      <M.Portal>
        <M.Content align={align} side={side} sideOffset={6} collisionPadding={8} aria-label={label} className={cn(panel, 'min-w-48')}>
          {children}
        </M.Content>
      </M.Portal>
    </M.Root>
  )
}

export function MenuItem({
  icon: Icon,
  children,
  onSelect,
  disabled,
  hint
}: {
  icon?: LucideIcon
  children: ReactNode
  onSelect: () => void
  disabled?: boolean
  hint?: ReactNode
}) {
  return (
    <M.Item className={itemClass} onSelect={onSelect} disabled={disabled ?? false}>
      {Icon && <Icon size={15} strokeWidth={1.75} className="text-fg-muted" aria-hidden />}
      <span className="flex-1">{children}</span>
      {hint && <span className="text-xs text-fg-subtle">{hint}</span>}
    </M.Item>
  )
}

export function MenuRadioGroup<V extends string>({
  value,
  onChange,
  options
}: {
  value: V
  onChange: (v: V) => void
  options: Array<{ value: V; label: string }>
}) {
  return (
    <M.RadioGroup value={value} onValueChange={(v) => onChange(v as V)}>
      {options.map((o) => (
        <M.RadioItem key={o.value} value={o.value} className={cn(itemClass, 'ps-8')}>
          <M.ItemIndicator className="absolute start-2.5 inline-flex text-accent-text">
            <Check size={14} aria-hidden />
          </M.ItemIndicator>
          {o.label}
        </M.RadioItem>
      ))}
    </M.RadioGroup>
  )
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <M.Label className="px-2.5 pt-1.5 pb-1 text-2xs font-semibold tracking-wide text-fg-subtle uppercase">{children}</M.Label>
}

export function MenuSeparator() {
  return <M.Separator className="-mx-1 my-1 h-px bg-line-subtle" />
}

export function Popover({
  trigger,
  children,
  align = 'end',
  label,
  open,
  onOpenChange,
  className
}: {
  trigger: ReactElement
  children: ReactNode
  align?: 'start' | 'end' | 'center'
  label: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
}) {
  return (
    <P.Root {...(open !== undefined ? { open } : {})} {...(onOpenChange ? { onOpenChange } : {})}>
      <P.Trigger asChild>{trigger}</P.Trigger>
      <P.Portal>
        <P.Content align={align} sideOffset={6} collisionPadding={8} aria-label={label} className={cn(panel, 'p-0', className)}>
          {children}
        </P.Content>
      </P.Portal>
    </P.Root>
  )
}
