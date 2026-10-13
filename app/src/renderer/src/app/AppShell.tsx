import { Suspense, useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import { pageVariants } from '@/design-system/motion'
import { useI18n, usePreferences } from '@/state/preferences'
import { useCaptureDialog } from './CaptureDialog'
import { useHotkeys } from './hotkeys'
import { SHORTCUT_NAV } from './navigation'
import { PageSkeleton, RouteBoundary } from './RouteBoundary'
import { QuickActions } from './QuickActions'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

/** Below this width the sidebar collapses to icons unless the user expanded it. */
const NARROW_QUERY = '(max-width: 1099px)'

function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY)
    const onChange = () => setNarrow(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return narrow
}

export function AppShell() {
  const { t } = useI18n()
  const { prefs, setPref } = usePreferences()
  const narrow = useIsNarrow()
  const collapsed = prefs.sidebarCollapsed ?? narrow
  const searchRef = useRef<HTMLInputElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const openCapture = useCaptureDialog()

  // A resize across the breakpoint returns the sidebar to automatic mode.
  useEffect(() => setPref('sidebarCollapsed', null), [narrow]) // eslint-disable-line react-hooks/exhaustive-deps

  // New page: scroll to top (hash targets on Settings handle themselves).
  useEffect(() => {
    if (!location.hash) mainRef.current?.scrollTo({ top: 0 })
  }, [location.pathname, location.hash])

  useHotkeys([
    { key: 'KeyK', ctrl: true, allowInFields: true, handler: () => searchRef.current?.focus() },
    { key: 'Slash', handler: () => searchRef.current?.focus() },
    { key: 'Space', ctrl: true, shift: true, allowInFields: true, handler: () => openCapture() },
    // Ctrl+1…9 keep their Phase 1 targets; Documents (Phase 4) has no digit shortcut.
    ...SHORTCUT_NAV.map((entry, i) => ({
      key: `Digit${i + 1}`,
      ctrl: true,
      allowInFields: true,
      handler: () => navigate(entry.path)
    }))
  ])

  return (
    <div className="flex h-full bg-canvas text-fg">
      <a
        href="#main"
        onClick={(e) => {
          e.preventDefault()
          mainRef.current?.focus()
        }}
        className="sr-only z-50 rounded-md bg-accent px-3 py-2 text-accent-fg focus:not-sr-only focus:fixed focus:start-3 focus:top-3"
      >
        {t.app.skipToContent}
      </a>
      <Sidebar collapsed={collapsed} onToggle={() => setPref('sidebarCollapsed', !collapsed)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar searchRef={searchRef} />
        <main id="main" ref={mainRef} tabIndex={-1} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto focus-visible:outline-none">
          <RouteBoundary key={location.pathname}>
            <Suspense fallback={<PageSkeleton />}>
              <motion.div key={location.pathname} className="h-full" variants={pageVariants} initial="initial" animate="animate">
                <Outlet />
              </motion.div>
            </Suspense>
          </RouteBoundary>
        </main>
      </div>
      <QuickActions />
    </div>
  )
}
