/**
 * 0003: imported documents, their extracted text (one row per PDF page; one
 * row for a TXT/Markdown file) and a unified FTS5 index.
 *
 * `search_index` stores NORMALISED text (see shared/search-text.ts) and is
 * maintained explicitly by the main process (no triggers, because the
 * normalisation lives in TypeScript). It is derived data: it can always be
 * rebuilt from `items`, `documents` and `document_pages`. Existing tables are
 * not altered.
 */
export const migration0003 = {
  version: 3,
  name: 'documents_search',
  sql: `
CREATE TABLE documents (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  file_name    TEXT NOT NULL CHECK (length(file_name) BETWEEN 1 AND 260),
  format       TEXT NOT NULL CHECK (format IN ('pdf', 'txt', 'md')),
  mime_type    TEXT NOT NULL,
  -- managed copy: a file name inside userData/documents, never an absolute path
  stored_name  TEXT NOT NULL UNIQUE,
  content_hash TEXT NOT NULL UNIQUE CHECK (length(content_hash) = 64),
  size_bytes   INTEGER NOT NULL CHECK (size_bytes > 0),
  status       TEXT NOT NULL CHECK (status IN ('imported', 'processing', 'indexed', 'no_text', 'failed')),
  page_count   INTEGER CHECK (page_count IS NULL OR page_count >= 0),
  char_count   INTEGER CHECK (char_count IS NULL OR char_count >= 0),
  last_error   TEXT,
  imported_at  TEXT NOT NULL,
  updated_at   TEXT NOT NULL
) STRICT;
CREATE INDEX documents_imported_at ON documents (imported_at DESC);
CREATE INDEX documents_status ON documents (status);

CREATE TABLE document_pages (
  document_id TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  page_no     INTEGER NOT NULL CHECK (page_no >= 1),
  text        TEXT NOT NULL,
  PRIMARY KEY (document_id, page_no)
) STRICT, WITHOUT ROWID;

-- kind: 'item' (note/idea/link/decision row of items), 'document' (title + file name), 'page'
CREATE VIRTUAL TABLE search_index USING fts5(
  title, body,
  kind UNINDEXED, ref_id UNINDEXED, page UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);
`
}
