import { useId, type InputHTMLAttributes, type ReactNode, type Ref, type TextareaHTMLAttributes } from 'react'
import { AlertCircle } from 'lucide-react'
import { motion } from 'motion/react'
import { cn } from '@/lib/cn'
import { TRANSITION } from '../motion'

export const inputClass = cn(
  'w-full rounded-md border border-line bg-surface text-base text-fg transition-colors',
  'hover:border-line-strong focus-visible:border-accent-line focus-visible:outline-accent/50 focus-visible:outline-offset-0',
  'aria-invalid:border-danger/70 disabled:cursor-not-allowed disabled:text-fg-disabled'
)

export interface FieldProps {
  label: string
  /** Render-prop receives the ids to wire label, hint and error. */
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode
  hint?: ReactNode
  error?: string | null
  optional?: string
  className?: string
}

export function Field({ label, children, hint, error, optional, className }: FieldProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="flex items-baseline gap-2 text-sm font-medium text-fg">
        {label}
        {optional && <span className="text-xs font-normal text-fg-subtle">{optional}</span>}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {error ? (
        <motion.p
          id={errorId}
          initial={{ opacity: 0, y: -3 }}
          animate={{ opacity: 1, y: 0 }}
          transition={TRANSITION.base}
          className="flex items-center gap-1.5 text-xs text-danger"
          role="alert"
        >
          <AlertCircle size={13} aria-hidden />
          {error}
        </motion.p>
      ) : (
        hint && (
          <p id={hintId} className="text-xs text-fg-subtle">
            {hint}
          </p>
        )
      )}
    </div>
  )
}

export function Input({ className, ref, ...rest }: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input ref={ref} className={cn(inputClass, 'h-8.5 px-3', className)} {...rest} />
}

export function Textarea({
  className,
  ref,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  return <textarea ref={ref} className={cn(inputClass, 'min-h-28 resize-y px-3 py-2 leading-relaxed', className)} {...rest} />
}
