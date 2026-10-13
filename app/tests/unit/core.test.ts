import { describe, expect, it } from 'vitest'
import { createSeed } from '@/mocks/seed'
import { workspaceReducer } from '@/state/reducer'
import { filterLibrary, filterTasks, globalSearch, keywordMatches, groupTasks } from '@/state/selectors'
import { normalizeText } from '@/lib/text'
import { createFormatter } from '@/lib/format'

const now = new Date('2026-10-12T12:00:00Z')
const data = createSeed(now)

describe('text normalisation', () => {
  it('unifies Arabic/Persian letters and digits', () => {
    expect(normalizeText('كتاب ي ۱۲۳')).toBe('کتاب ی 123')
  })
})

describe('library filtering', () => {
  const q = { text: '', kinds: [], tagIds: [], sort: 'updated' as const }
  it('filters by kind, text and tag', () => {
    expect(filterLibrary(data, { ...q, kinds: ['link'] }, 'en').every((i) => i.kind === 'link')).toBe(true)
    expect(filterLibrary(data, { ...q, text: 'sqlite' }, 'en').length).toBeGreaterThan(0)
    expect(filterLibrary(data, { ...q, text: 'zzzz-no-match' }, 'en')).toHaveLength(0)
    expect(filterLibrary(data, { ...q, tagIds: ['tag-sqlite'] }, 'en').length).toBe(1)
  })
  it('sorts by title', () => {
    const r = filterLibrary(data, { ...q, sort: 'title-asc' }, 'en')
    expect((r[0]?.title ?? '').toLowerCase() <= (r[1]?.title ?? '').toLowerCase()).toBe(true)
  })
})

describe('tasks', () => {
  it('applies a committed change set to the cache (replace, prepend, remove)', () => {
    const id = 'task-search-adr'
    const current = data.tasks.find((t) => t.id === id)!
    const updated = { ...current, status: 'done' as const, completedAt: now.toISOString() }
    const empty = { tags: [], projects: [], items: [], tasks: [], decisions: [], activity: [], removed: [] }
    const done = workspaceReducer(data, { type: 'changes/apply', changes: { ...empty, tasks: [updated] } })
    expect(done.tasks).toHaveLength(data.tasks.length)
    expect(done.tasks.find((t) => t.id === id)?.completedAt).toBe(now.toISOString())
    const fresh = { ...updated, id: 'task-new' }
    expect(workspaceReducer(done, { type: 'changes/apply', changes: { ...empty, tasks: [fresh] } }).tasks[0]?.id).toBe('task-new')
    const gone = workspaceReducer(done, { type: 'changes/apply', changes: { ...empty, removed: [{ type: 'task', id }] } })
    expect(gone.tasks.some((t) => t.id === id)).toBe(false)
  })
  it('filters and groups', () => {
    expect(filterTasks(data.tasks, { status: 'done', priority: 'all', projectId: 'all' }).every((t) => t.status === 'done')).toBe(true)
    expect(groupTasks(data.tasks, now).some((g) => g.group === 'done')).toBe(true)
  })
})

describe('search', () => {
  it('finds across groups and handles empty queries', () => {
    expect(globalSearch(data, 'BM25').total).toBeGreaterThan(0)
    expect(globalSearch(data, '   ').total).toBe(0)
  })
  it('keyword matches only reference existing items', () => {
    const refs = keywordMatches(data, 'Why did we choose SQLite?')
    expect(refs.length).toBeGreaterThan(0)
    expect(refs.every((r) => data.items.some((i) => i.id === r.id))).toBe(true)
    expect(keywordMatches(data, 'qqqqzzzz')).toEqual([])
  })
})

describe('formatter', () => {
  it('formats Persian weekday dates', () => {
    const f = createFormatter('fa', 'persian', () => now)
    expect(f.weekdayDate(now)).toContain('،')
  })
})
