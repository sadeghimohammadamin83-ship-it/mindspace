import type { Database } from 'better-sqlite3'
import type { ActivityEvent, ActivityKind, ActivityMeta, SourceRef } from '@shared/domain'
import { fromOrigin, toOrigin, type StoredOrigin } from './rows'

interface ActivityRow {
  id: string
  kind: ActivityKind
  subject: string
  ref_type: SourceRef['type']
  ref_id: string
  project_id: string | null
  meta: string | null
  origin: StoredOrigin
  at: string
}

/** The activity panel shows a few dozen entries; older ones stay stored but are not loaded. */
export const ACTIVITY_LOAD_LIMIT = 100
export const PROJECT_ACTIVITY_DEFAULT = 30

/** Metadata is written by this app only, but a damaged value must never break the timeline. */
function parseMeta(raw: string | null): ActivityMeta | undefined {
  if (!raw) return undefined
  try {
    const v = JSON.parse(raw) as ActivityMeta
    const r = v?.related
    if (r && typeof r.id === 'string' && typeof r.type === 'string' && typeof r.title === 'string') return { related: r }
  } catch {
    // fall through
  }
  return undefined
}

const toEvent = (r: ActivityRow): ActivityEvent => {
  const meta = parseMeta(r.meta)
  return {
    id: r.id,
    kind: r.kind,
    subject: r.subject,
    ref: { type: r.ref_type, id: r.ref_id },
    projectId: r.project_id,
    ...(meta ? { meta } : {}),
    at: r.at,
    origin: toOrigin(r.origin)
  }
}

export function createActivityRepo(db: Database) {
  const q = {
    recent: db.prepare<[number], ActivityRow>('SELECT * FROM activity_events ORDER BY at DESC, rowid DESC LIMIT ?'),
    forProject: db.prepare<[string, string | null, string | null, number], ActivityRow>(
      `SELECT * FROM activity_events WHERE project_id = ? AND (? IS NULL OR at < ?)
       ORDER BY at DESC, rowid DESC LIMIT ?`
    ),
    insert: db.prepare(
      `INSERT INTO activity_events (id, kind, subject, ref_type, ref_id, project_id, meta, origin, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    removeFor: db.prepare('DELETE FROM activity_events WHERE ref_type = ? AND ref_id = ?')
  }
  return {
    recent: (limit = ACTIVITY_LOAD_LIMIT): ActivityEvent[] => q.recent.all(limit).map(toEvent),
    /** Newest first; `before` pages backwards through a long history. */
    forProject: (projectId: string, limit = PROJECT_ACTIVITY_DEFAULT, before?: string): ActivityEvent[] =>
      q.forProject.all(projectId, before ?? null, before ?? null, limit).map(toEvent),
    insert: (e: ActivityEvent): void =>
      void q.insert.run(
        e.id,
        e.kind,
        e.subject,
        e.ref.type,
        e.ref.id,
        e.projectId,
        e.meta ? JSON.stringify(e.meta) : null,
        fromOrigin(e.origin),
        e.at
      ),
    removeFor: (ref: SourceRef): void => void q.removeFor.run(ref.type, ref.id)
  }
}
export type ActivityRepo = ReturnType<typeof createActivityRepo>
