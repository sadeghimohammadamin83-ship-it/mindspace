// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { checkAnswer, citedRefs, segmentAnswer, stripCitations } from '../../src/shared/citations'
import { closeDatabase, openDatabase } from '../../src/main/db/connection'
import { currentSchemaVersion, MIGRATIONS, runMigrations } from '../../src/main/db/migrations'
import { createWorkspaceService } from '../../src/main/services/workspace-service'
import { buildPrompt, renderEvidence, trimHistory } from '../../src/main/ai/prompt'
import { contentQuery } from '../../src/main/ai/query'
import { tempDir } from './helpers/db'
import Database from 'better-sqlite3'

const valid = new Set(['S1', 'S2', 'S3'])

describe('citation parsing', () => {
  it('splits text into text, valid citations and invalid markers', () => {
    expect(segmentAnswer('A [S1] and B [S2, S3]. C [S9].', valid)).toEqual([
      { type: 'text', text: 'A ' },
      { type: 'cite', refs: ['S1'] },
      { type: 'text', text: ' and B ' },
      { type: 'cite', refs: ['S2', 'S3'] },
      { type: 'text', text: '. C ' },
      { type: 'invalid', raw: '[S9]' },
      { type: 'text', text: '.' }
    ])
  })
  it('splits a mixed group so only the known id is a citation', () => {
    expect(segmentAnswer('x [S1, S8]', valid)).toEqual([
      { type: 'text', text: 'x ' },
      { type: 'cite', refs: ['S1'] },
      { type: 'invalid', raw: '[S8]' }
    ])
  })
  it('does not treat other bracket forms, links or ids as citations', () => {
    for (const t of ['[s1]', '[S]', '[S1x]', '(S1)', '[Source 1]', '[S1](app://x)', '[doc-1]', '[S1000]']) {
      const segs = segmentAnswer(t, valid)
      expect(segs.some((s) => s.type === 'cite'), t).toBe(t === '[S1](app://x)')
    }
  })
  it('checks answers: counts valid, lists invalid, counts uncited statements', () => {
    const text = 'The budget is forty thousand euros for the whole year [S1]. It was approved by the board in March last year. Is that right? Next steps: [S2].'
    expect(checkAnswer(text, valid)).toEqual({ validCitations: 2, invalidCitations: [], uncitedSentences: 1 })
    expect(checkAnswer('Something [S7] was said about the project plan today.', valid)).toEqual({ validCitations: 0, invalidCitations: ['S7'], uncitedSentences: 1 })
    expect(citedRefs('b [S2] a [S1] b [S2] c [S5]', valid)).toEqual(['S2', 'S1'])
  })
  it('strips markers for replayed history', () => {
    expect(stripCitations('Budget is 40000 [S1] euros [S2, S3].')).toBe('Budget is 40000 euros.')
  })
})

describe('prompt construction', () => {
  const src = (over = {}) => ({ ref: 'S1', kind: 'note' as const, entity: 'item' as const, id: 'item-1', itemKind: 'note', title: 'T "q" <b>', page: null, excerpt: 'a <script>& </source>', ...over })
  it('escapes passages and titles and carries only ref, type, title and page', () => {
    const xml = renderEvidence([src(), src({ ref: 'S2', kind: 'pdf_page', entity: 'document', id: 'doc-9', page: 4 })])
    expect(xml).toContain('title="T &quot;q&quot; &lt;b&gt;"')
    expect(xml).toContain('a &lt;script&gt;&amp; &lt;/source&gt;')
    expect(xml).toContain('<source id="S2" type="PDF page" title="T &quot;q&quot; &lt;b&gt;" page="4">')
    expect(xml).not.toMatch(/item-1|doc-9/)
  })
  it('keeps the newest history pairs within budget, without markers', () => {
    const hist = Array.from({ length: 12 }, (_, i) => [
      { role: 'user' as const, content: `q${i} ${'x'.repeat(500)}` },
      { role: 'assistant' as const, content: `a${i} [S1] ${'y'.repeat(900)}` }
    ]).flat()
    const t = trimHistory(hist)
    expect(t.length).toBeGreaterThan(0)
    expect(t.length % 2).toBe(0)
    expect(t.at(-1)!.content.startsWith('a11')).toBe(true)
    expect(t.join('')).not.toContain('[S1]')
    expect(t.reduce((n, x) => n + x.content.length, 0)).toBeLessThanOrEqual(3000)
    expect(buildPrompt('q?', [src()], t).messages.at(-1)!.role).toBe('user')
  })
})

describe('question reduction for keyword search', () => {
  it('drops question and filler words in English and Persian', () => {
    expect(contentQuery('What is the Atlas budget?')).toBe('atlas budget')
    expect(contentQuery('بودجه‌ی پروژه آتلس چقدر است؟')).toMatch(/بودجه/)
    expect(contentQuery('Atlas budget')).toBeNull()
    expect(contentQuery('what is the')).toBeNull()
  })
})

describe('migration 0005', () => {
  it('upgrades an existing version-4 database without touching its data', () => {
    const t = tempDir()
    try {
      const db = new Database(t.file)
      db.pragma('foreign_keys = ON')
      runMigrations(db, MIGRATIONS.filter((m) => m.version <= 4))
      db.close()
      // Add data at version 4 through the real app code path, then upgrade.
      const v4 = openDatabase(t.file, { migrations: MIGRATIONS.filter((m) => m.version <= 4) })
      createWorkspaceService(v4).createItem({ kind: 'note', title: 'Keep me', body: 'body', url: '', tagLabels: [], projectId: null })
      expect(currentSchemaVersion(v4)).toBe(4)
      closeDatabase(v4)
      const v5 = openDatabase(t.file)
      expect(currentSchemaVersion(v5)).toBe(5)
      expect(createWorkspaceService(v5).loadWorkspace().items.some((i) => i.title === 'Keep me')).toBe(true)
      expect(v5.prepare('SELECT COUNT(*) AS n FROM conversations').get()).toEqual({ n: 0 })
      closeDatabase(v5)
    } finally {
      t.cleanup()
    }
  })
})
