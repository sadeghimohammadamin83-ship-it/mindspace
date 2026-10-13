import type { ReactNode } from 'react'

export function PageHeader({
  title,
  description,
  actions,
  eyebrow
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  eyebrow?: ReactNode
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight text-fg" dir="auto">
          {title}
        </h1>
        {description && <p className="mt-1 max-w-2xl text-base text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

/** Standard page frame: consistent margins and a readable maximum width. */
export function Page({ children, width = 'wide' }: { children: ReactNode; width?: 'wide' | 'narrow' }) {
  return (
    <div className={width === 'narrow' ? 'mx-auto w-full max-w-3xl px-8 py-7' : 'mx-auto w-full max-w-[1320px] px-8 py-7'}>
      {children}
    </div>
  )
}
