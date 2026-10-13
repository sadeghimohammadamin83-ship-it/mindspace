# ADR 0007: Backup, restore and recovery

Status: accepted (Phase 8). Code: `src/main/backup/*`, `src/main/ipc/backup-handlers.ts`, `src/shared/backup*.ts`, UI in `features/settings/Backup*.tsx`.

## What is authoritative
| Store | Where | In the backup? |
|---|---|---|
| Database (notes, projects, tasks, decisions, tags, links, activity, preferences, conversations + messages, ai_settings without keys, documents rows, document_pages, FTS5 `search_index`, `semantic_sources`/`semantic_chunks` with embeddings) | `userData/mindspace.sqlite3` (WAL) | Yes: one consistent snapshot |
| Managed document copies | `userData/documents/doc-<uuid>.<ext>` | Yes, only files the snapshot's `documents` rows reference |
| AI keys | `userData/ai-credentials.json` (safeStorage/DPAPI) | **Never** (bound to the Windows account; re-enter after restore) |
| Embedding model | `userData/models/...` | No (large, re-downloadable, checksum-pinned) |
| Backup bookkeeping | `userData/backup-state.json`, `restore-journal.json` | No (must survive a restore) |

The FTS index and embeddings live inside the database, so they are restored with it; nothing needs rebuilding. At start-up the existing `documents.recover()` still reconciles the FTS index and orphan files. Semantic search additionally needs the model installed on that computer.

## Format (v1)
`MSBACKUP` magic, u16 format version, encrypted flag, then a plaintext body: `manifest.json` first, then entries (`data/database/mindspace.sqlite3`, `data/documents/<managed name>`), a zero terminator and a SHA-256 trailer over the body. Format version (container/manifest layout) is separate from `database.schemaVersion` (migration level). A reader refuses a newer format or a newer schema; older schemas are upgraded by the normal migrations when opened. Entry names are allow-listed (three exact shapes), so traversal/absolute/drive/backslash names are rejected before anything is read; extraction creates regular files with `wx`; limits: 20 000 entries, 16 GiB, 8 MiB manifest.

## Encryption
Optional, password-based. scrypt (N=2^17, r=8, p=1, random 16-byte salt) → AES-256-GCM through `node:crypto`, in 1 MiB chunks with a random 8-byte nonce prefix + counter; the AAD is the whole file header plus a final-chunk flag (STREAM construction), so reordering, truncation and header/KDF edits fail authentication. Reader bounds the KDF parameters. No custom primitives. A wrong password and a damaged first chunk are indistinguishable (reported together). The password is never stored, logged or returned. Unencrypted backups are labelled as such everywhere; the SHA-256 trailer detects accidents, not malicious modification.

## Snapshot
`better-sqlite3`'s `db.backup()` (SQLite online backup API) copies pages in steps of 200, yielding to the event loop, reading in short transactions, so the app keeps running; safe in WAL mode (writes by the same connection during the copy are mirrored into it). The copy is switched to `journal_mode=DELETE` (single file), `integrity_check` and `foreign_key_check` must pass, then it is hashed. Documents are copied after the snapshot; a document deleted in between is reported as a warning (`verified_with_warnings`), never silently.

## Create → publish
space check → snapshot → copy documents → manifest/checksums → write `.part` beside the destination → verify the written file completely (decrypting if needed) → rename to a free name (`name (2).msbak`, never overwrite) → record. Anything failing removes the `.part` and the staging folder and records nothing.

## Restore (activate at next start)
Windows cannot replace an open database, so: validate (full verify, compatibility) → stage into `restore-staging/<id>` and re-check → block renderer write channels → verified safety backup of the current state (`backups/safety`, last 3 kept) → write journal `staged` → relaunch. On start, before any connection exists: `staged → activating` (rename db/-wal/-shm/documents into `restore-previous/<id>`, move staged in, integrity check) `→ activated`. The app then opens the database; only if that works is the journal `completed` and the raw previous copy removed (the safety backup stays). A failed step, a crash while `activating`, or an activated database that will not open moves everything back (`rolled_back`). The journal names no paths (they derive from the validated id). If the database cannot be opened at all, the error screen offers "Restore from a backup".

## Automatic backups and retention
In-session only: a single timer (guarded against duplicates) checks at start-up (+30 s) and every 15 min; one backup per due period (daily/weekly), no catch-up bursts, one-hour back-off after a failure, never overlapping any other operation. Auto backups are unencrypted (no stored password). Retention keeps the newest N (default 7, 1–60) verified auto backups and deletes only files that are tracked in `backup-state.json`, of kind `auto`, and whose names match the generated pattern; manual exports are never touched; failed/missing auto records are forgotten, not counted.

## IPC
12 invoke channels + 1 push channel; zod strict schemas; no path parameter anywhere. Native dialogs open in main; chosen files are held behind 128-bit tokens (30 min TTL, max 5). Errors are `BackupError`s with fixed plain messages.
