/**
 * 0005: AI conversations (Phase 6). Additive: no existing table is altered.
 *
 * conversations / messages: Ask Your Memory history. `seq` orders messages
 *   inside a conversation. Assistant rows record how they ended (`status`:
 *   complete, cancelled with the partial text so far, or error with no text)
 *   plus minimal generation metadata (provider, model, finish reason, token
 *   counts if the provider reported them, duration).
 * `sources_json`: ONLY the sources the answer cited with a valid marker, as
 *   they were supplied to the model (entity, id, title, page, bounded excerpt).
 *   It is a snapshot, not a live link: when a record is deleted later the
 *   citation stays readable but is shown as "no longer available".
 * `check_json`: the citation check (valid / invalid ids, uncited sentences).
 * ai_settings: non-secret provider settings as JSON. API keys are NEVER stored
 *   here (see main/ai/credentials.ts).
 */
export const migration0005 = {
  version: 5,
  name: 'conversations',
  sql: `
CREATE TABLE conversations (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX conversations_updated ON conversations (updated_at DESC);

CREATE TABLE messages (
  id                 TEXT PRIMARY KEY,
  conversation_id    TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  seq                INTEGER NOT NULL CHECK (seq >= 0),
  role               TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content            TEXT NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('complete', 'cancelled', 'error')),
  error_code         TEXT,
  provider           TEXT CHECK (provider IS NULL OR provider IN ('ollama', 'anthropic', 'openai')),
  model              TEXT,
  finish             TEXT CHECK (finish IS NULL OR finish IN ('stop', 'length', 'refusal', 'other')),
  input_tokens       INTEGER,
  output_tokens      INTEGER,
  duration_ms        INTEGER,
  no_evidence        INTEGER NOT NULL DEFAULT 0 CHECK (no_evidence IN (0, 1)),
  semantic_available INTEGER CHECK (semantic_available IS NULL OR semantic_available IN (0, 1)),
  sources_json       TEXT,
  check_json         TEXT,
  created_at         TEXT NOT NULL,
  UNIQUE (conversation_id, seq)
) STRICT;

CREATE TABLE ai_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
`
}
