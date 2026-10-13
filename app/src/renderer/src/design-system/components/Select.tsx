import { Select as S } from 'radix-ui'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'
import { inputClass } from './Field'

export interface SelectOption<V extends string> {
  value: V
  label: string
  disabled?: boolean
}

export interface SelectProps<V extends string> {
  value: V
  onChange: (value: V) => void
  options: Array<SelectOption<V>>
  id?: string
  'aria-label'?: string
  'aria-describedby'?: string
  size?: 'sm' | 'md'
  className?: string
  disabled?: boolean
}

export function Select<V extends string>({
  value,
  onChange,
  options,
  id,
  size = 'md',
  className,
  disabled,
  ...aria
}: SelectProps<V>) {
  return (
    <S.Root value={value} onValueChange={(v) => onChange(v as V)} disabled={disabled ?? false}>
      <S.Trigger
        id={id}
        aria-label={aria['aria-label']}
        aria-describedby={aria['aria-describedby']}
        className={cn(
          inputClass,
          'inline-flex items-center justify-between gap-2 text-start',
          size === 'sm' ? 'h-7 px-2.5 text-sm' : 'h-8.5 px-3',
          className
        )}
      >
        <span className="truncate">
          <S.Value />
        </span>
        <S.Icon>
          <ChevronDown size={14} className="text-fg-subtle" aria-hidden />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content
          position="popper"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) animate-pop-in overflow-hidden rounded-lg border border-line bg-raised p-1 shadow-lg"
        >
          <S.Viewport>
            {options.map((o) => (
              <S.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled ?? false}
                className="relative flex h-8 cursor-default items-center rounded-md ps-7 pe-3 text-base text-fg outline-none select-none data-disabled:text-fg-disabled data-highlighted:bg-hover"
              >
                <S.ItemIndicator className="absolute start-2 inline-flex text-accent-text">
                  <Check size={14} aria-hidden />
                </S.ItemIndicator>
                <S.ItemText>{o.label}</S.ItemText>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  )
}
