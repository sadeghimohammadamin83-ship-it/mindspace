import { useId } from 'react'
import { RadioGroup } from 'radix-ui'
import { motion } from 'motion/react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { TRANSITION } from '../motion'

export interface SegmentOption<V extends string> {
  value: V
  label: string
  icon?: LucideIcon
  disabled?: boolean
}

/** A row of mutually exclusive choices (radio group semantics, arrow-key navigation). */
export function Segmented<V extends string>({
  value,
  onChange,
  options,
  label,
  id,
  size = 'md',
  className
}: {
  value: V
  onChange: (value: V) => void
  options: Array<SegmentOption<V>>
  label: string
  id?: string
  size?: 'sm' | 'md'
  className?: string
}) {
  const thumbId = useId()
  return (
    <RadioGroup.Root
      id={id}
      value={value}
      onValueChange={(v) => onChange(v as V)}
      aria-label={label}
      orientation="horizontal"
      loop
      className={cn('inline-flex flex-wrap gap-1 rounded-lg border border-line-subtle bg-surface p-1', className)}
    >
      {options.map(({ value: v, label: l, icon: Icon, disabled }) => (
        <RadioGroup.Item
          key={v}
          value={v}
          disabled={disabled ?? false}
          className={cn(
            'relative inline-flex items-center gap-1.5 rounded-md font-medium text-fg-muted transition-colors',
            'hover:bg-hover hover:text-fg data-[state=checked]:text-fg data-[state=checked]:hover:bg-transparent',
            'disabled:cursor-not-allowed disabled:text-fg-disabled disabled:hover:bg-transparent',
            size === 'sm' ? 'h-6.5 px-2.5 text-sm' : 'h-7.5 px-3 text-sm'
          )}
        >
          {v === value && (
            <motion.span
              layoutId={thumbId}
              aria-hidden
              transition={TRANSITION.spring}
              className="absolute inset-0 rounded-md bg-active shadow-sm"
            />
          )}
          {Icon && <Icon size={14} strokeWidth={1.75} aria-hidden className="relative" />}
          <span className="relative">{l}</span>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  )
}
