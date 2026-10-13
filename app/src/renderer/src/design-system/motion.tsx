/**
 * MINDSPACE motion system: one set of durations, easings and springs for the
 * whole app. CSS twins live in tokens.css (--duration-*, --ease-out), so
 * Tailwind transitions and Motion animations feel the same.
 *
 * Rules: animate opacity/transform only; nothing blocks input; reduced
 * motion (OS setting or the in-app switch) removes movement everywhere.
 */
import type { ReactNode } from 'react'
import { MotionConfig, type Transition } from 'motion/react'
import { usePreferences } from '@/state/preferences'

export const EASE_OUT = [0.2, 0.8, 0.2, 1] as const

export const DURATION = {
  /** Hover and press feedback. */
  fast: 0.12,
  /** Standard UI transitions: menus, rows, toasts. */
  base: 0.18,
  /** Dialogs, drawers, page changes. */
  slow: 0.26
} as const

export const TRANSITION = {
  fast: { duration: DURATION.fast, ease: EASE_OUT },
  base: { duration: DURATION.base, ease: EASE_OUT },
  slow: { duration: DURATION.slow, ease: EASE_OUT },
  /** Shared indicators (active nav item, segmented thumb). Critically damped: no wobble. */
  spring: { type: 'spring', stiffness: 520, damping: 40, mass: 0.8 },
  /** Layout shifts such as a list re-ordering. */
  layout: { type: 'spring', stiffness: 420, damping: 38, mass: 0.9 }
} satisfies Record<string, Transition>

/** Page enter: short fade plus a 6px rise. No exit, so navigation is never delayed. */
export const pageVariants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: TRANSITION.slow }
}

/** Applies the in-app "Reduce motion" switch; "user" follows the OS setting. */
export function MotionProvider({ children }: { children: ReactNode }) {
  const { prefs } = usePreferences()
  return <MotionConfig reducedMotion={prefs.reduceMotion ? 'always' : 'user'}>{children}</MotionConfig>
}
