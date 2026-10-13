import type { IsoDate, IsoDateTime } from '@shared/domain'
import { daysUntil, fromIsoDate } from './dates'

export type Lang = 'fa' | 'en'
export type CalendarKind = 'persian' | 'gregory'

export interface DueInfo {
  days: number
  tone: 'overdue' | 'today' | 'soon' | 'later'
}

/** Locale-aware formatting for numbers and dates in the chosen calendar. */
export interface Formatter {
  number(n: number): string
  percent(ratio: number): string
  date(iso: IsoDateTime | IsoDate, style?: 'short' | 'medium' | 'long'): string
  weekdayDate(d: Date): string
  relative(iso: IsoDateTime): string
  due(iso: IsoDate): DueInfo
}

function locale(lang: Lang, calendar: CalendarKind): string {
  return lang === 'fa' ? `fa-IR-u-ca-${calendar}-nu-arabext` : `en-GB-u-ca-${calendar}`
}

export function createFormatter(lang: Lang, calendar: CalendarKind, now: () => Date): Formatter {
  const loc = locale(lang, calendar)
  const num = new Intl.NumberFormat(loc)
  const pct = new Intl.NumberFormat(loc, { style: 'percent', maximumFractionDigits: 0 })
  const dateFmt = {
    short: new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'short' }),
    medium: new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'short', year: 'numeric' }),
    long: new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'long', year: 'numeric' })
  }
  const weekday = new Intl.DateTimeFormat(loc, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })
  const rtf = new Intl.RelativeTimeFormat(lang === 'fa' ? 'fa-IR' : 'en-GB', { numeric: 'auto' })

  const toDate = (iso: string): Date => (iso.length === 10 ? fromIsoDate(iso) : new Date(iso))

  return {
    number: (n) => num.format(n),
    percent: (r) => pct.format(r),
    date: (iso, style = 'short') => {
      const d = toDate(iso)
      // Show the year only when it differs from the current one.
      if (style === 'short' && d.getFullYear() !== now().getFullYear()) {
        return dateFmt.medium.format(d)
      }
      return dateFmt[style].format(d)
    },
    weekdayDate: (d) => {
      // ICU orders Persian-calendar parts oddly; compose them explicitly.
      const p = Object.fromEntries(weekday.formatToParts(d).map((x) => [x.type, x.value]))
      return lang === 'fa'
        ? `${p['weekday']}، ${p['day']} ${p['month']} ${p['year']}`
        : weekday.format(d)
    },
    relative: (iso) => {
      const diffSec = (new Date(iso).getTime() - now().getTime()) / 1000
      const abs = Math.abs(diffSec)
      if (abs < 60) return rtf.format(0, 'second')
      if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute')
      if (abs < 86_400) return rtf.format(Math.round(diffSec / 3600), 'hour')
      if (abs < 86_400 * 30) return rtf.format(Math.round(diffSec / 86_400), 'day')
      return dateFmt.medium.format(new Date(iso))
    },
    due: (iso) => {
      const days = daysUntil(iso, now())
      const tone = days < 0 ? 'overdue' : days === 0 ? 'today' : days <= 3 ? 'soon' : 'later'
      return { days, tone }
    }
  }
}
