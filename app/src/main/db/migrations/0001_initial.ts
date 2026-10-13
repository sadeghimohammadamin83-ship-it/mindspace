/**
 * 0001: initial schema. `items` holds every knowledge record (note, idea,
 * link, decision) as Phase 0's data model describes; tasks and projects have
 * their own tables. Timestamps are ISO-8601 UTC text; due dates are YYYY-MM-DD.
 *
 * Deletion rules:
 *  - deleting a project keeps its notes and tasks and clears their project_id;
 *  - deleting a note or tag removes only the item_tags links;
 *  - activity rows are removed with the record they point to (service layer).
 */
export const migration0001 = {
  version: 1,
  name: 'initial',
  sql: `
CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 140),
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL CHECK (status IN ('planning', 'active', 'on_hold', 'completed')),
  origin      TEXT NOT NULL DEFAULT 'user' CHECK (origin IN ('sample', 'user')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
) STRICT;

CREATE TABLE items (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('note', 'idea', 'link', 'decision')),
  title       TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 140),
  body        TEXT NOT NULL DEFAULT '',
  url         TEXT,
  project_id  TEXT REFERENCES projects (id) ON DELETE SET NULL,
  -- normalised title + body + url, so search is case- and Persian-variant-insensitive
  search_text TEXT NOT NULL DEFAULT '',
  origin      TEXT NOT NULL DEFAULT 'user' CHECK (origin IN ('sample', 'user')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  CHECK (kind <> 'link' OR url IS NOT NULL)
) STRICT;
CREATE INDEX items_updated_at ON items (updated_at DESC);
CREATE INDEX items_project_id ON items (project_id);
CREATE INDEX items_kind ON items (kind);

CREATE TABLE tags (
  id         TEXT PRIMARY KEY,
  label      TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 40),
  label_key  TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE item_tags (
  item_id TEXT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
) STRICT;
CREATE INDEX item_tags_tag_id ON item_tags (tag_id);

CREATE TABLE tasks (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 140),
  notes        TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL CHECK (status IN ('todo', 'in_progress', 'done')),
  priority     TEXT NOT NULL CHECK (priority IN ('high', 'medium', 'low')),
  due_date     TEXT CHECK (due_date IS NULL OR due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  project_id   TEXT REFERENCES projects (id) ON DELETE SET NULL,
  origin       TEXT NOT NULL DEFAULT 'user' CHECK (origin IN ('sample', 'user')),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  completed_at TEXT,
  CHECK ((status = 'done') = (completed_at IS NOT NULL))
) STRICT;
CREATE INDEX tasks_status_due ON tasks (status, due_date);
CREATE INDEX tasks_project_id ON tasks (project_id);
CREATE INDEX tasks_updated_at ON tasks (updated_at DESC);

CREATE TABLE activity_events (
  id       TEXT PRIMARY KEY,
  kind     TEXT NOT NULL CHECK (kind IN ('item_captured', 'task_created', 'task_completed', 'task_reopened', 'task_updated', 'project_created')),
  subject  TEXT NOT NULL,
  ref_type TEXT NOT NULL CHECK (ref_type IN ('item', 'task', 'project')),
  ref_id   TEXT NOT NULL,
  origin   TEXT NOT NULL DEFAULT 'user' CHECK (origin IN ('sample', 'user')),
  at       TEXT NOT NULL
) STRICT;
CREATE INDEX activity_events_at ON activity_events (at DESC);
CREATE INDEX activity_events_ref ON activity_events (ref_type, ref_id);

-- Non-sensitive UI preferences only (keys are allowlisted in code). Never secrets.
CREATE TABLE preferences (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

-- Internal flags, e.g. whether sample data was ever inserted.
CREATE TABLE app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
`
} as const
