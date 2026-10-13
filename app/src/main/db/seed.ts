/**
 * Inserts the sample workspace into a brand-new database, once. Kept apart
 * from migrations: the schema never depends on sample data.
 *
 * Runs only when the `sample_seeded` flag is absent AND the database holds no
 * projects, notes or tasks. The flag is written in the same transaction, so a
 * user who removes the samples never gets them back, and user data is never
 * touched or overwritten.
 */
import type { Database } from 'better-sqlite3'
import { createSeed } from '@shared/sample-data'
import { normalizeText } from '@shared/text'
import { createDecisionsRepo } from './repositories/decisions'
import { createActivityRepo } from './repositories/activity'
import { createItemsRepo } from './repositories/items'
import { createProjectsRepo } from './repositories/projects'
import { createTasksRepo } from './repositories/tasks'

const FLAG = 'sample_seeded'

export function seedSampleDataIfNew(db: Database, now = new Date()): boolean {
  return db
    .transaction(() => {
      if (db.prepare('SELECT 1 FROM app_meta WHERE key = ?').get(FLAG)) return false
      const counts = db
        .prepare('SELECT (SELECT COUNT(*) FROM projects) + (SELECT COUNT(*) FROM items) + (SELECT COUNT(*) FROM tasks) AS n')
        .get() as { n: number }
      if (counts.n > 0) {
        // Existing data without the flag: mark as seeded and leave it alone.
        db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?)').run(FLAG, 'skipped-existing-data')
        return false
      }
      const seed = createSeed(now)
      const at = now.toISOString()
      const insertTag = db.prepare('INSERT INTO tags (id, label, label_key, created_at) VALUES (?, ?, ?, ?)')
      for (const t of seed.tags) insertTag.run(t.id, t.label, normalizeText(t.label), at)
      const projects = createProjectsRepo(db)
      for (const p of seed.projects) projects.insert(p)
      const items = createItemsRepo(db)
      const link = db.prepare('INSERT INTO item_tags (item_id, tag_id) VALUES (?, ?)')
      for (const i of seed.items) {
        items.insert(i)
        for (const tagId of i.tagIds) link.run(i.id, tagId)
      }
      const tasks = createTasksRepo(db)
      for (const t of seed.tasks) tasks.insert(t)
      const decisions = createDecisionsRepo(db)
      const linkDecisionTag = db.prepare('INSERT INTO decision_tags (decision_id, tag_id) VALUES (?, ?)')
      for (const d of seed.decisions) {
        decisions.insert(d)
        for (const id of d.noteIds) decisions.link(d.id, 'item', id, at)
        for (const id of d.taskIds) decisions.link(d.id, 'task', id, at)
        for (const id of d.tagIds) linkDecisionTag.run(d.id, id)
      }
      const activity = createActivityRepo(db)
      for (const a of seed.activity) activity.insert(a)
      db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?)').run(FLAG, at)
      return true
    })
    .immediate()
}
