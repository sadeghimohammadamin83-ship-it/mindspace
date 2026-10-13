/**
 * 0004: the semantic (embedding) index. Derived data only: every row can be
 * rebuilt from `items`, `documents` and `document_pages`, so nothing here is
 * user content of its own. Existing tables are not altered.
 *
 * semantic_sources: one row per indexed source (a note-like item or a
 *   document). `content_hash` + `model_id` identify what the stored chunks
 *   were made from; `source_version` is the source's updated_at, used as a
 *   cheap "may have changed" check. Rows exist only for COMMITTED indexing
 *   (or a recorded failure), so an interrupted run never looks complete.
 * semantic_chunks: character ranges of one source unit (note text, or one
 *   document page) plus their vectors (little-endian float32 BLOB).
 *
 * Deleting an item or document cascades to its source row and chunks, in
 * the same transaction as the deletion, so no stale citation can survive it.
 */
export const migration0004 = {
  version: 4,
  name: 'semantic_index',
  sql: `
CREATE TABLE semantic_sources (
  source_key     TEXT PRIMARY KEY,
  source_type    TEXT NOT NULL CHECK (source_type IN ('item', 'document')),
  item_id        TEXT REFERENCES items (id) ON DELETE CASCADE,
  document_id    TEXT REFERENCES documents (id) ON DELETE CASCADE,
  source_version TEXT NOT NULL,
  content_hash   TEXT NOT NULL CHECK (length(content_hash) = 64),
  model_id       TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('ready', 'failed')),
  chunk_count    INTEGER NOT NULL DEFAULT 0 CHECK (chunk_count >= 0),
  last_error     TEXT,
  indexed_at     TEXT NOT NULL,
  CHECK ((source_type = 'item') = (item_id IS NOT NULL)),
  CHECK ((source_type = 'document') = (document_id IS NOT NULL))
) STRICT;
CREATE INDEX semantic_sources_item ON semantic_sources (item_id);
CREATE INDEX semantic_sources_document ON semantic_sources (document_id);

CREATE TABLE semantic_chunks (
  id          TEXT PRIMARY KEY,
  source_key  TEXT NOT NULL REFERENCES semantic_sources (source_key) ON DELETE CASCADE,
  -- one-based PDF/text page; NULL for notes
  page        INTEGER CHECK (page IS NULL OR page >= 1),
  ordinal     INTEGER NOT NULL CHECK (ordinal >= 0),
  char_start  INTEGER NOT NULL CHECK (char_start >= 0),
  char_end    INTEGER NOT NULL CHECK (char_end > char_start),
  text        TEXT NOT NULL CHECK (length(text) > 0),
  model_id    TEXT NOT NULL,
  dimensions  INTEGER NOT NULL CHECK (dimensions > 0),
  embedding   BLOB NOT NULL CHECK (length(embedding) = dimensions * 4),
  created_at  TEXT NOT NULL,
  UNIQUE (source_key, ordinal)
) STRICT;
CREATE INDEX semantic_chunks_model ON semantic_chunks (model_id);
`
}
