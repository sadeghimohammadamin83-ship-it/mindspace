import type { IsoDate } from './domain'

const DAY_MS = 86_400_000

/** Local calendar day as YYYY-MM-DD. */
export function toIsoDate(d: Date): IsoDate {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Parses YYYY-MM-DD as local midnight. */
export function fromIsoDate(iso: IsoDate): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export function addDays(d: Date, days: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + days)
  return out
}

/** Whole days from today to `iso` (negative when it is in the past). */
export function daysUntil(iso: IsoDate, now: Date): number {
  return Math.round((fromIsoDate(iso).getTime() - startOfDay(now).getTime()) / DAY_MS)
}

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  return toIsoDate(fromIsoDate(value)) === value
}
