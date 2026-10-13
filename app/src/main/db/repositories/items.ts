import type { Database } from 'better-sqlite3'
import type { Id, ItemKind, KnowledgeItem } from '@shared/domain'
import type { ItemSearch } from '@shared/contracts'
import { normalizeText } from '@shared/text'
import { createSearchRepo } from './search'
import { fromOrigin, toOrigin, type StoredOrigin } from './rows'

interface ItemRow {
  id: string
  kind: ItemKind
  title: string
  body: string
  url: string | null
  project_id: string | null
  origin: StoredOrigin
  created_at: string
  updated_at: string
}

const COLUMNS = 'id, kind, title, body, url, project_id, origin, created_at, updated_at'
const DEFAULT_SEARCH_LIMIT = 50

/** Escapes LIKE wildcards so user text is always matched literally. */
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

export const searchTextFor = (i: Pick<KnowledgeItem, 'title' | 'body' | 'url'>) =>
  normalizeText([i.title, i.body, i.url ?? ''].join(' '))

export function createItemsRepo(db: Database) {
  // The full-text index is kept in step with every item write (same transaction as the caller's).
  const index = createSearchRepo(db)
  const q = {
    get: db.prepare<[string], ItemRow>(`SELECT ${COLUMNS} FROM items WHERE id = ?`),
    list: db.prepare<[], ItemRow>(`SELECT ${COLUMNS} FROM items ORDER BY updated_at DESC`),
    allTags: db.prepare<[], { item_id: string; tag_id: string }>('SELECT item_id, tag_id FROM item_tags ORDER BY rowid'),
    tagsFor: db.prepare<[string], { tag_id: string }>('SELECT tag_id FROM item_tags WHERE item_id = ? ORDER BY rowid'),
    insert: db.prepare(
      `INSERT INTO items (id, kind, title, body, url, project_id, search_text, origin, created_at, updated_at)
       VALUES (@id, @kind, @title, @body, @url, @project_id, @search_text, @origin, @created_at, @updated_at)`
    ),
    update: db.prepare(
      `UPDATE items SET title = @title, body = @body, url = @url, project_id = @project_id,
         search_text = @search_text, updated_at = @updated_at WHERE id = @id`
    ),
    byProject: db.prepare<[string], { id: string }>('SELECT id FROM items WHERE project_id = ?'),
    remove: db.prepare('DELETE FROM items WHERE id = ?')
  }

  const toItem = (r: ItemRow, tagIds: Id[]): KnowledgeItem => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    ...(r.url ? { url: r.url } : {}),
    tagIds,
    projectId: r.project_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    origin: toOrigin(r.origin)
  })
  const withTags = (r: ItemRow) => toItem(r, q.tagsFor.all(r.id).map((t) => t.tag_id))

  return {
    get(id: Id): KnowledgeItem | null {
      const r = q.get.get(id)
      return r ? withTags(r) : null
    },
    list(): KnowledgeItem[] {
      const tags = new Map<string, Id[]>()
      for (const { item_id, tag_id } of q.allTags.all()) {
        const list = tags.get(item_id)
        if (list) list.push(tag_id)
        else tags.set(item_id, [tag_id])
      }
      return q.list.all().map((r) => toItem(r, tags.get(r.id) ?? []))
    },
    /**
     * Case-insensitive substring search over title, body and URL, using the
     * same Persian-aware normalisation as the UI. Parameterised and bounded.
     */
    search(s: ItemSearch): KnowledgeItem[] {
      const where: string[] = []
      const params: unknown[] = []
      const text = normalizeText(s.text)
      if (text) {
        where.push("search_text LIKE ? ESCAPE '\\'")
        params.push(likePattern(text))
      }
      if (s.kind) {
        where.push('kind = ?')
        params.push(s.kind)
      }
      if (s.projectId) {
        where.push('project_id = ?')
        params.push(s.projectId)
      }
      if (s.tagId) {
        where.push('EXISTS (SELECT 1 FROM item_tags t WHERE t.item_id = items.id AND t.tag_id = ?)')
        params.push(s.tagId)
      }
      params.push(s.limit ?? DEFAULT_SEARCH_LIMIT)
      // Only fixed fragments above are joined; every value is a bound parameter.
      const sql = `SELECT ${COLUMNS} FROM items ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                   ORDER BY updated_at DESC LIMIT ?`
      return (db.prepare(sql).all(...params) as ItemRow[]).map(withTags)
    },
    idsInProject: (projectId: Id): Id[] => q.byProject.all(projectId).map((r) => r.id),
    insert(i: KnowledgeItem): void {
      q.insert.run({
        id: i.id,
        kind: i.kind,
        title: i.title,
        body: i.body,
        url: i.url ?? null,
        project_id: i.projectId,
        search_text: searchTextFor(i),
        origin: fromOrigin(i.origin),
        created_at: i.createdAt,
        updated_at: i.updatedAt
      })
      index.indexItem(i)
    },
    update(i: KnowledgeItem): void {
      q.update.run({
        id: i.id,
        title: i.title,
        body: i.body,
        url: i.url ?? null,
        project_id: i.projectId,
        search_text: searchTextFor(i),
        updated_at: i.updatedAt
      })
      index.indexItem(i)
    },
    remove(id: Id): boolean {
      index.removeItem(id)
      return q.remove.run(id).changes > 0
    }
  }
}
export type ItemsRepo = ReturnType<typeof createItemsRepo>
