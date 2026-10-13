import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, X } from 'lucide-react'
import { motion } from 'motion/react'
import { cn } from '@/lib/cn'
import { TRANSITION } from '../motion'

export type Tone = 'neutral' | 'accent' | 'success' | 'info' | 'warning' | 'danger'

const toneClass: Record<Tone, string> = {
  neutral: 'bg-raised text-fg-muted border-line',
  accent: 'bg-accent-soft text-accent-text border-accent-line',
  success: 'bg-success-soft text-success border-success/25',
  info: 'bg-info-soft text-info border-info/25',
  warning: 'bg-warning-soft text-warning border-warning/25',
  danger: 'bg-danger-soft text-danger border-danger/25'
}

const dotClass: Record<Tone, string> = {
  neutral: 'bg-fg-subtle',
  accent: 'bg-accent',
  success: 'bg-success',
  info: 'bg-info',
  warning: 'bg-warning',
  danger: 'bg-danger'
}

export function Badge({
  tone = 'neutral',
  dot,
  icon: Icon,
  children,
  className
}: {
  tone?: Tone
  dot?: boolean
  icon?: LucideIcon
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full border px-2 text-2xs font-medium whitespace-nowrap',
        toneClass[tone],
        className
      )}
    >
      {dot && <span className={cn('size-1.5 rounded-full', dotClass[tone])} aria-hidden />}
      {Icon && <Icon size={11} strokeWidth={2} aria-hidden />}
      {children}
    </span>
  )
}

export function Tag({
  children,
  onRemove,
  removeLabel,
  onClick,
  active,
  title
}: {
  children: ReactNode
  onRemove?: () => void
  removeLabel?: string
  onClick?: () => void
  active?: boolean
  title?: string
}) {
  const base = cn(
    'inline-flex h-5.5 max-w-48 items-center gap-1 rounded-md border px-1.5 text-xs transition-colors',
    active ? 'border-accent-line bg-accent-soft text-accent-text' : 'border-line-subtle bg-raised text-fg-muted'
  )
  const label = (
    <span className="truncate" dir="auto">
      <span className="text-fg-subtle">#</span>
      {children}
    </span>
  )
  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={title} aria-label={title} aria-pressed={active} className={cn(base, 'hover:border-line-strong hover:text-fg')}>
        {label}
      </button>
    )
  }
  return (
    <span className={base}>
      {label}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="-me-0.5 inline-flex size-4 items-center justify-center rounded-sm text-fg-subtle hover:bg-hover hover:text-fg"
        >
          <X size={11} aria-hidden />
        </button>
      )}
    </span>
  )
}

/** A titled group of content. Lists inside use rows, not nested cards. */
export function Panel({
  title,
  icon: Icon,
  action,
  children,
  className,
  bodyClassName,
  badge,
  id
}: {
  title?: string
  icon?: LucideIcon
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  badge?: ReactNode
  id?: string
}) {
  return (
    <section
      aria-labelledby={title && id ? `${id}-title` : undefined}
      className={cn('flex min-w-0 flex-col rounded-xl border border-line-subtle bg-surface', className)}
    >
      {title && (
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line-subtle px-4">
          {Icon && <Icon size={15} strokeWidth={1.75} className="text-fg-subtle" aria-hidden />}
          <h2 id={id ? `${id}-title` : undefined} className="truncate text-sm font-semibold text-fg">
            {title}
          </h2>
          {badge}
          <div className="ms-auto flex items-center gap-1">{action}</div>
        </header>
      )}
      <div className={cn('min-h-0 flex-1', bodyClassName)}>{children}</div>
    </section>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact
}: {
  icon: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  compact?: boolean
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={TRANSITION.slow}
      className={cn('flex flex-col items-center justify-center text-center', compact ? 'gap-2 px-4 py-8' : 'gap-3 px-6 py-16')}
    >
      <div className={cn('flex items-center justify-center rounded-xl border border-line-subtle bg-raised text-fg-subtle', compact ? 'size-9' : 'size-12')}>
        <Icon size={compact ? 17 : 21} strokeWidth={1.5} aria-hidden />
      </div>
      <div className="max-w-sm">
        <p className={cn('font-medium text-fg', compact ? 'text-sm' : 'text-md')}>{title}</p>
        {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
      </div>
      {action}
    </motion.div>
  )
}

export function ErrorState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl border border-danger/25 bg-danger-soft text-danger">
        <AlertTriangle size={21} strokeWidth={1.5} aria-hidden />
      </div>
      <div className="max-w-sm">
        <p className="text-md font-medium text-fg">{title}</p>
        {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
      </div>
      {action}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-md bg-raised', className)} />
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const ratio = max === 0 ? 0 : Math.min(1, value / max)
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className="h-1.5 w-full overflow-hidden rounded-full bg-hover"
    >
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${ratio * 100}%` }}
        transition={TRANSITION.slow}
        className={cn('h-full rounded-full transition-colors', ratio === 1 ? 'bg-success' : 'bg-accent')}
      />
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd
      dir="ltr"
      className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line border-b-line-strong bg-raised px-1.5 font-sans text-2xs font-medium text-fg-muted"
    >
      {children}
    </kbd>
  )
}

export function Notice({
  icon: Icon,
  children,
  tone = 'neutral',
  onDismiss,
  dismissLabel
}: {
  icon: LucideIcon
  children: ReactNode
  tone?: 'neutral' | 'accent' | 'info'
  onDismiss?: () => void
  dismissLabel?: string
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm',
        tone === 'accent'
          ? 'border-accent-line bg-accent-soft text-fg'
          : tone === 'info'
            ? 'border-info/25 bg-info-soft text-fg'
            : 'border-line-subtle bg-raised text-fg-muted'
      )}
    >
      <Icon
        size={15}
        strokeWidth={1.75}
        aria-hidden
        className={cn('mt-0.5 shrink-0', tone === 'accent' ? 'text-accent-text' : tone === 'info' ? 'text-info' : 'text-fg-subtle')}
      />
      <div className="min-w-0 flex-1">{children}</div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label={dismissLabel} className="rounded-sm text-fg-subtle hover:text-fg">
          <X size={14} aria-hidden />
        </button>
      )}
    </div>
  )
}
