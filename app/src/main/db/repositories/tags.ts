import type { Database } from 'better-sqlite3'
import type { Id, Tag } from '@shared/domain'
import { normalizeText } from '@shared/text'

interface TagRow {
  id: string
  label: string
}

export function createTagsRepo(db: Database) {
  const q = {
    list: db.prepare<[], TagRow>('SELECT id, label FROM tags ORDER BY created_at, rowid'),
    get: db.prepare<[string], TagRow>('SELECT id, label FROM tags WHERE id = ?'),
    byKey: db.prepare<[string], TagRow>('SELECT id, label FROM tags WHERE label_key = ?'),
    insert: db.prepare('INSERT INTO tags (id, label, label_key, created_at) VALUES (?, ?, ?, ?)'),
    rename: db.prepare('UPDATE tags SET label = ?, label_key = ? WHERE id = ?'),
    remove: db.prepare('DELETE FROM tags WHERE id = ?'),
    itemsWith: db.prepare<[string], { id: string }>('SELECT item_id AS id FROM item_tags WHERE tag_id = ?'),
    decisionsWith: db.prepare<[string], { id: string }>('SELECT decision_id AS id FROM decision_tags WHERE tag_id = ?'),
    forItem: db.prepare<[string], { tag_id: string }>('SELECT tag_id FROM item_tags WHERE item_id = ? ORDER BY rowid'),
    link: db.prepare('INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)'),
    unlinkAll: db.prepare('DELETE FROM item_tags WHERE item_id = ?')
  }
  return {
    list: (): Tag[] => q.list.all(),
    get: (id: Id): Tag | null => q.get.get(id) ?? null,
    /**
     * Tag identity policy: two labels are the same tag when their normalised
     * form matches (case-insensitive, Persian/Arabic letter variants, digits,
     * ZWNJ and extra spaces ignored). The first spelling used is displayed.
     * `label_key` is UNIQUE, so the database enforces this too.
     */
    ensure(label: string, newId: () => Id, at: string): { tag: Tag; created: boolean } {
      const clean = label.trim().replace(/^#/, '').trim()
      const key = normalizeText(clean)
      const found = q.byKey.get(key)
      if (found) return { tag: found, created: false }
      const tag = { id: newId(), label: clean }
      q.insert.run(tag.id, tag.label, key, at)
      return { tag, created: true }
    },
    /** Renames in place. Returns false when another tag already uses the normalised label. */
    rename(id: Id, label: string): boolean {
      const clean = label.trim().replace(/^#/, '').trim()
      const key = normalizeText(clean)
      const other = q.byKey.get(key)
      if (other && other.id !== id) return false
      q.rename.run(clean, key, id)
      return true
    },
    /** Deletes the tag and, through ON DELETE CASCADE, only its link rows. */
    remove: (id: Id): boolean => q.remove.run(id).changes > 0,
    itemIdsWith: (id: Id): Id[] => q.itemsWith.all(id).map((r) => r.id),
    decisionIdsWith: (id: Id): Id[] => q.decisionsWith.all(id).map((r) => r.id),
    tagIdsForItem: (itemId: Id): Id[] => q.forItem.all(itemId).map((r) => r.tag_id),
    /** Replaces an item's tag links. Tags themselves are never deleted here. */
    setItemTags(itemId: Id, tagIds: Id[]): void {
      q.unlinkAll.run(itemId)
      for (const tagId of tagIds) q.link.run(itemId, tagId)
    }
  }
}
export type TagsRepo = ReturnType<typeof createTagsRepo>
