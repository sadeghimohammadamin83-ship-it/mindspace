import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Button, buttonClass, ErrorState, Skeleton } from '@/design-system/components'
import { useI18n } from '@/state/preferences'

interface BoundaryProps {
  children: ReactNode
  fallback: (reset: () => void) => ReactNode
}

class Boundary extends Component<BoundaryProps, { error: Error | null }> {
  override state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface the error in the console; a real log sink arrives in Phase 2.
    console.error('[MINDSPACE] page error', error, info.componentStack)
  }
  override render() {
    return this.state.error ? this.props.fallback(() => this.setState({ error: null })) : this.props.children
  }
}

/** Keeps a failing page from taking the whole app down. */
export function RouteBoundary({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  return (
    <Boundary
      fallback={(reset) => (
        <ErrorState
          title={t.errors.pageTitle}
          description={t.errors.pageHint}
          action={
            <div className="flex gap-2">
              <Button onClick={reset}>{t.common.retry}</Button>
              <Link to="/" onClick={reset} className={buttonClass('ghost')}>
                {t.errors.toDashboard}
              </Link>
            </div>
          }
        />
      )}
    >
      {children}
    </Boundary>
  )
}

/** Shown while a page's code is loading. */
export function PageSkeleton() {
  const { t } = useI18n()
  return (
    <div className="mx-auto w-full max-w-[1320px] px-8 py-7" role="status" aria-label={t.common.loading}>
      <Skeleton className="h-8 w-56" />
      <Skeleton className="mt-3 h-4 w-96 max-w-full" />
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
      <Skeleton className="mt-4 h-64" />
    </div>
  )
}
