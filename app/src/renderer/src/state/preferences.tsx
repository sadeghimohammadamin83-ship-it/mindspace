/**
 * UI preferences (language, calendar, motion, sidebar) and the i18n helpers
 * derived from them. Stored values are loaded before the first render (see
 * main.tsx) and every change is passed to `onChange`, which saves it.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Direction } from 'radix-ui'
import type { ItemKind } from '@shared/domain'
import { en, type Messages } from '@/lib/i18n/en'
import { fa } from '@/lib/i18n/fa'
import { createFormatter, type CalendarKind, type Formatter, type Lang } from '@/lib/format'

export interface Preferences {
  lang: Lang
  calendar: CalendarKind
  reduceMotion: boolean
  /** null = automatic (collapsed on narrow windows). */
  sidebarCollapsed: boolean | null
  defaultCaptureKind: ItemKind | 'task'
  showSidebarCounts: boolean
}

export const DEFAULT_PREFERENCES: Preferences = {
  lang: 'fa',
  calendar: 'persian',
  reduceMotion: false,
  sidebarCollapsed: null,
  defaultCaptureKind: 'note',
  showSidebarCounts: true
}

interface PreferencesContextValue {
  prefs: Preferences
  setPref<K extends keyof Preferences>(key: K, value: Preferences[K]): void
}

interface I18nValue {
  t: Messages
  lang: Lang
  dir: 'rtl' | 'ltr'
  /** BCP-47 locale for collation and similar APIs. */
  locale: string
  fmt: Formatter
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null)
const I18nContext = createContext<I18nValue | null>(null)

const dictionaries: Record<Lang, Messages> = { fa, en }

/** Re-renders every minute, so greetings and relative times stay current. */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

export function PreferencesProvider({
  children,
  initial,
  onChange
}: {
  children: ReactNode
  initial?: Partial<Preferences>
  /** Called with each changed preference, e.g. to persist it. */
  onChange?: (patch: Partial<Preferences>) => void
}) {
  const [prefs, setPrefs] = useState<Preferences>({ ...DEFAULT_PREFERENCES, ...initial })
  const now = useNow()

  const prefValue = useMemo<PreferencesContextValue>(
    () => ({
      prefs,
      setPref: (key, value) => {
        setPrefs((p) => ({ ...p, [key]: value }))
        onChange?.({ [key]: value })
      }
    }),
    [prefs, onChange]
  )

  const i18n = useMemo<I18nValue>(() => {
    const dir = prefs.lang === 'fa' ? 'rtl' : 'ltr'
    return {
      t: dictionaries[prefs.lang],
      lang: prefs.lang,
      dir,
      locale: prefs.lang === 'fa' ? 'fa-IR' : 'en-GB',
      fmt: createFormatter(prefs.lang, prefs.calendar, () => new Date())
    }
    // `now` keeps formatters fresh as the clock moves.
  }, [prefs.lang, prefs.calendar, now])

  useEffect(() => {
    const root = document.documentElement
    root.lang = prefs.lang
    root.dir = i18n.dir
    root.dataset['reduceMotion'] = String(prefs.reduceMotion)
  }, [prefs.lang, prefs.reduceMotion, i18n.dir])

  return (
    <PreferencesContext.Provider value={prefValue}>
      <I18nContext.Provider value={i18n}>
        <Direction.Provider dir={i18n.dir}>{children}</Direction.Provider>
      </I18nContext.Provider>
    </PreferencesContext.Provider>
  )
}

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext)
  if (!ctx) throw new Error('usePreferences must be used inside <PreferencesProvider>')
  return ctx
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside <PreferencesProvider>')
  return ctx
}
