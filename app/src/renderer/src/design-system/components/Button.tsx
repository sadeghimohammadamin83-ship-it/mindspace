import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'
import { Loader2, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Tooltip } from './Tooltip'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-accent-fg hover:bg-accent-hover active:bg-accent disabled:bg-raised disabled:text-fg-disabled',
  secondary:
    'bg-raised text-fg border border-line hover:bg-hover hover:border-line-strong active:bg-active disabled:text-fg-disabled disabled:hover:bg-raised disabled:hover:border-line',
  ghost:
    'text-fg-muted hover:bg-hover hover:text-fg active:bg-active disabled:text-fg-disabled disabled:hover:bg-transparent',
  danger:
    'bg-danger-soft text-danger border border-danger/30 hover:border-danger/60 active:bg-danger/20 disabled:opacity-50'
}

const sizes: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-sm gap-1.5',
  md: 'h-8.5 px-3.5 text-base gap-2'
}

export const buttonClass = (variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', extra?: string) =>
  cn(
    'inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap select-none transition-[background-color,border-color,color,transform] active:not-disabled:scale-[0.98] disabled:cursor-not-allowed',
    variants[variant],
    sizes[size],
    extra
  )

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: LucideIcon
  iconEnd?: LucideIcon
  loading?: boolean
  ref?: Ref<HTMLButtonElement>
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  iconEnd: IconEnd,
  loading = false,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const iconSize = size === 'sm' ? 14 : 16
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass(variant, size, className)}
      {...rest}
    >
      {loading ? (
        <Loader2 size={iconSize} className="animate-spin" aria-hidden />
      ) : (
        Icon && <Icon size={iconSize} aria-hidden strokeWidth={1.75} />
      )}
      {children}
      {IconEnd && <IconEnd size={iconSize} aria-hidden strokeWidth={1.75} className="flip-rtl" />}
    </button>
  )
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: LucideIcon
  /** Accessible name, also shown as a tooltip. */
  label: string
  size?: ButtonSize
  variant?: 'ghost' | 'secondary'
  tooltip?: ReactNode | false
  flip?: boolean
  ref?: Ref<HTMLButtonElement>
}

export function IconButton({
  icon: Icon,
  label,
  size = 'md',
  variant = 'ghost',
  tooltip,
  flip,
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  const button = (
    <button
      type={type}
      aria-label={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:text-fg-disabled',
        variant === 'ghost'
          ? 'text-fg-muted hover:bg-hover hover:text-fg active:bg-active disabled:hover:bg-transparent'
          : 'border border-line bg-raised text-fg-muted hover:bg-hover hover:text-fg',
        size === 'sm' ? 'size-7' : 'size-8.5',
        className
      )}
      {...rest}
    >
      <Icon size={size === 'sm' ? 15 : 17} strokeWidth={1.75} aria-hidden className={flip ? 'flip-rtl' : undefined} />
    </button>
  )
  if (tooltip === false) return button
  return <Tooltip content={tooltip ?? label}>{button}</Tooltip>
}
