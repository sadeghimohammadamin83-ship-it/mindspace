import { Checkbox as C, Switch as S } from 'radix-ui'
import { Check } from 'lucide-react'
import { cn } from '@/lib/cn'

/** Round completion checkbox used for tasks. */
export function TaskCheck({
  checked,
  onChange,
  label,
  disabled
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <C.Root
      checked={checked}
      onCheckedChange={(v) => onChange(v === true)}
      aria-label={label}
      disabled={disabled ?? false}
      className={cn(
        'group inline-flex size-4.5 shrink-0 items-center justify-center rounded-full border transition-colors',
        'border-line-strong hover:border-accent data-[state=checked]:border-success data-[state=checked]:bg-success'
      )}
    >
      <C.Indicator forceMount className="text-canvas data-[state=checked]:animate-check-pop data-[state=unchecked]:hidden">
        <Check size={11} strokeWidth={3} aria-hidden />
      </C.Indicator>
    </C.Root>
  )
}

export function Switch({
  checked,
  onChange,
  id,
  disabled,
  ...aria
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  id?: string
  disabled?: boolean
  'aria-describedby'?: string
  'aria-label'?: string
}) {
  return (
    <S.Root
      id={id}
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled ?? false}
      {...aria}
      className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-line-strong bg-hover transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:opacity-50"
    >
      <S.Thumb className="block size-3.5 translate-x-0.5 rounded-full bg-fg-muted shadow-sm transition-transform data-[state=checked]:translate-x-4.5 data-[state=checked]:bg-accent-fg rtl:-translate-x-0.5 rtl:data-[state=checked]:-translate-x-4.5" />
    </S.Root>
  )
}
