/**
 * 0002: project memory (Phase 3).
 *
 *  - `decisions` is a first-class record with structured fields and its own
 *    status; a decision keeps its row (and its text) when superseded.
 *  - `decision_items` / `decision_tasks` / `decision_tags` are many-to-many
 *    junction tables. Deleting either side removes only the link row.
 *  - Notes, tasks and decisions belong to at most one project through a
 *    nullable `project_id` (ON DELETE SET NULL), the model Phase 2 already used.
 *  - `activity_events` gains `project_id` and `meta` and accepts the new event
 *    kinds and the `decision` ref type. SQLite cannot alter a CHECK
 *    constraint, so the table is rebuilt by copy: every existing row is kept,
 *    and `project_id` is back-filled from the record each event points at.
 */
export const migration0002 = {
  version: 2,
  name: 'project_memory',
  sql: `
CREATE TABLE decisions (
  id            TEXT PRIMARY KEY,
  project_id    TEXT REFERENCES projects (id) ON DELETE SET NULL,
  title         TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 140),
  context       TEXT NOT NULL DEFAULT '',
  decision      TEXT NOT NULL CHECK (length(trim(decision)) > 0),
  rationale     TEXT NOT NULL DEFAULT '',
  alternatives  TEXT NOT NULL DEFAULT '',
  consequences  TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL CHECK (status IN ('proposed', 'accepted', 'rejected', 'superseded')),
  decided_on    TEXT CHECK (decided_on IS NULL OR decided_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  -- If the replacement is deleted this becomes NULL; the decision stays superseded.
  superseded_by TEXT REFERENCES decisions (id) ON DELETE SET NULL,
  origin        TEXT NOT NULL DEFAULT 'user' CHECK (origin IN ('sample', 'user')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  CHECK (superseded_by IS NULL OR (status = 'superseded' AND superseded_by <> id))
) STRICT;
CREATE INDEX decisions_project_id ON decisions (project_id);
CREATE INDEX decisions_updated_at ON decisions (updated_at DESC);
CREATE INDEX decisions_superseded_by ON decisions (superseded_by);

CREATE TABLE decision_items (
  decision_id TEXT NOT NULL REFERENCES decisions (id) ON DELETE CASCADE,
  item_id     TEXT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (decision_id, item_id)
) STRICT;
CREATE INDEX decision_items_item_id ON decision_items (item_id);

CREATE TABLE decision_tasks (
  decision_id TEXT NOT NULL REFERENCES decisions (id) ON DELETE CASCADE,
  task_id     TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (decision_id, task_id)
) STRICT;
CREATE INDEX decision_tasks_task_id ON decision_tasks (task_id);

CREATE TABLE decision_tags (
  decision_id TEXT NOT NULL REFERENCES decisions (id) ON DELETE CASCADE,
  tag_id      TEXT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  PRIMARY KEY (decision_id, tag_id)
) STRICT;
CREATE INDEX decision_tags_tag_id ON decision_tags (tag_id);

CREATE TABLE activity_events_v2 (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN (
    'item_captured', 'task_created', 'task_completed', 'task_reopened', 'task_updated', 'project_created',
    'project_updated', 'item_updated', 'item_project_linked', 'item_project_unlinked',
    'task_project_linked', 'task_project_unlinked',
    'decision_created', 'decision_updated', 'decision_accepted', 'decision_rejected',
    'decision_superseded', 'decision_reopened', 'decision_link_added', 'decision_link_removed')),
  subject    TEXT NOT NULL,
  ref_type   TEXT NOT NULL CHECK (ref_type IN ('item', 'task', 'project', 'decision')),
  ref_id     TEXT NOT NULL,
  project_id TEXT REFERENCES projects (id) ON DELETE SET NULL,
  meta       TEXT,
  origin     TEXT NOT NULL DEFAULT 'user' CHECK (origin IN ('sample', 'user')),
  at         TEXT NOT NULL
) STRICT;
INSERT INTO activity_events_v2 (id, kind, subject, ref_type, ref_id, project_id, meta, origin, at)
SELECT a.id, a.kind, a.subject, a.ref_type, a.ref_id,
       CASE a.ref_type
         WHEN 'project' THEN (SELECT id FROM projects WHERE id = a.ref_id)
         WHEN 'item' THEN (SELECT project_id FROM items WHERE id = a.ref_id)
         WHEN 'task' THEN (SELECT project_id FROM tasks WHERE id = a.ref_id)
       END,
       NULL, a.origin, a.at
FROM activity_events a;
DROP TABLE activity_events;
ALTER TABLE activity_events_v2 RENAME TO activity_events;
CREATE INDEX activity_events_at ON activity_events (at DESC);
CREATE INDEX activity_events_ref ON activity_events (ref_type, ref_id);
CREATE INDEX activity_events_project ON activity_events (project_id, at DESC);
`
} as const
