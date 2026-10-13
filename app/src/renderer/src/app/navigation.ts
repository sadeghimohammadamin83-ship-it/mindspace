import {
  FolderKanban,
  Gavel,
  LayoutGrid,
  Library,
  FileText,
  ListChecks,
  MessageCircleQuestion,
  PenLine,
  Settings2,
  Sunrise,
  type LucideIcon
} from 'lucide-react'
import type { SourceRef } from '@shared/domain'
import type { Messages } from '@/lib/i18n/en'

export type NavKey = keyof Pick<
  Messages['nav'],
  'dashboard' | 'capture' | 'library' | 'documents' | 'projects' | 'tasks' | 'decisions' | 'ask' | 'briefing' | 'settings'
>

export interface NavEntry {
  key: NavKey
  path: string
  icon: LucideIcon
  group: 'workspace' | 'insight' | 'system'
}

/** Sidebar order; Ctrl+1…9 follows the same order. */
export const NAV: NavEntry[] = [
  { key: 'dashboard', path: '/', icon: LayoutGrid, group: 'workspace' },
  { key: 'capture', path: '/capture', icon: PenLine, group: 'workspace' },
  { key: 'library', path: '/library', icon: Library, group: 'workspace' },
  { key: 'documents', path: '/documents', icon: FileText, group: 'workspace' },
  { key: 'projects', path: '/projects', icon: FolderKanban, group: 'workspace' },
  { key: 'tasks', path: '/tasks', icon: ListChecks, group: 'workspace' },
  { key: 'decisions', path: '/decisions', icon: Gavel, group: 'workspace' },
  { key: 'ask', path: '/ask', icon: MessageCircleQuestion, group: 'insight' },
  { key: 'briefing', path: '/briefing', icon: Sunrise, group: 'insight' },
  { key: 'settings', path: '/settings', icon: Settings2, group: 'system' }
]

/** Entries with a Ctrl+digit shortcut (Phase 1 order kept; Documents has none). */
export const SHORTCUT_NAV = NAV.filter((n) => n.key !== 'documents')

export function navEntryFor(pathname: string): NavEntry | undefined {
  if (pathname === '/') return NAV[0]
  if (pathname === '/tags') return NAV.find((n) => n.key === 'library')
  return NAV.find((n) => n.path !== '/' && (pathname === n.path || pathname.startsWith(`${n.path}/`)))
}

/** Where a reference to a record opens. */
export function refPath(ref: SourceRef): string {
  switch (ref.type) {
    case 'item':
      return `/library?item=${encodeURIComponent(ref.id)}`
    case 'project':
      return `/projects/${encodeURIComponent(ref.id)}`
    case 'task':
      return `/tasks?task=${encodeURIComponent(ref.id)}`
    case 'decision':
      return `/decisions?decision=${encodeURIComponent(ref.id)}`
  }
}

/** A document, optionally at a page (one-based) with search terms to highlight. */
export function documentPath(id: string, page?: number, q?: string): string {
  const p = new URLSearchParams()
  if (page && page > 1) p.set('page', String(page))
  if (q) p.set('q', q)
  const s = p.toString()
  return `/documents/${encodeURIComponent(id)}${s ? `?${s}` : ''}`
}
