# DEVLOG

## Phase 1 (UI prototype)
Done: secure Electron shell, design tokens, 8 screens, fa/en + RTL, in-memory workspace, unit + E2E tests.
Not done / deferred (see completion report): Windows launch untested; no persistence (Phase 2); Phase 0 items outside this brief's 8 screens (Inbox, command palette, 16-page set, ESLint/CI, docs/screens captured on Windows).
Deviations from Phase 0: no TanStack Query/Zustand/Zod (not needed yet; reducer + context); Radix used directly; no ESLint/Prettier yet; HashRouter for the `app://` scheme.

## UI Motion Upgrade
Added `motion` (MIT) as the single animation library; Radix stays for behaviour. Tokens and helpers in `design-system/motion.tsx` (durations 120/180/260ms, one ease-out curve, two springs, `MotionProvider` wired to the in-app Reduce motion switch and the OS setting). Radix overlays (dialog, drawer, menu, popover, tooltip) get CSS exit animations via `data-[state=closed]`.
Changed: sliding nav indicator, page enter (opacity + 6px, no exit so navigation is never delayed), search panel open/close and gliding highlight, Segmented sliding thumb, toasts, task and library rows (layout glide on reorder, no replay on filter), Ask messages/thinking/sources, activity badge and list, empty states, progress bars, button press, task check pop.
No code was copied from 21st.dev, Magic UI, React Bits or Aceternity; their patterns (shared-layout indicator, animated list, command-style search) were reimplemented against MINDSPACE tokens, so no third-party attribution is required beyond the `motion` dependency.
Not tested: Windows.

## Phase 2 (local storage)
Added SQLite persistence (better-sqlite3 13, Node-API, no native rebuild) and Zod IPC validation; see `docs/adr/0002-sqlite-data-layer.md`. Notes/ideas/links/decisions, projects, tasks, tags, activity and UI preferences persist in `userData/mindspace.sqlite3`. UI writes wait for the database and show "Not saved" on failure. Ask conversations stay session-only; the Settings "reset" action is disabled (no destructive resets).
Fixed a Phase 1 bug: `isTrustedUrl` compared `URL.origin`, which is `"null"` for `app://`, so every IPC call from the packaged renderer was rejected (About showed "browser"). It now compares scheme + host.
Tested on Linux only (unit, jsdom UI, Electron E2E including two real launches on one profile). Not tested: Windows.

## Phase 3 (project memory)
Added decisions, relationships, tag management and a project timeline on top of the Phase 2 database; see `docs/adr/0003-project-memory.md`. Migration 0002 adds `decisions`, `decision_items`, `decision_tasks`, `decision_tags` and rebuilds `activity_events` (copy, data kept). Project pages are now workspaces (Overview, Notes, Tasks, Decisions, Activity); new pages `/decisions` and `/tags`; Related Content lists on notes, tasks and decisions.
Existing Phase 2 tests were adjusted only where they hard-coded the migration count or the list of IPC methods.
Tested on Linux only (unit, jsdom UI, Electron E2E including a restart). Not tested: Windows.

## Phase 4 (documents and full-text search)
Added document import (PDF/TXT/Markdown), page-level PDF extraction with pdf.js in a worker thread, migration 0003 (`documents`, `document_pages`, FTS5 `search_index`), unified search (notes + documents + PDF pages) with page references and snippets, a Documents page, an extracted-text reader with page navigation, and document hits in the top-bar search. See `docs/adr/0004-documents-and-search.md`.
Fixtures in `tests/fixtures/documents` are synthetic (`scripts/make-fixtures.py`); no files from the user's computer were used.
Existing tests changed only where they hard-coded the migration count or the bridge/channel list.
Tested on Linux only (unit, jsdom UI, Electron E2E with real worker extraction and a restart). Not tested: Windows, real-world PDFs.

## Phase 5 (semantic search and hybrid retrieval)
Added a local multilingual embedding model (multilingual-e5-small, int8 ONNX, pinned and checksum-verified, downloaded only on an explicit Settings action), inference in a worker thread, source-aware chunking with PDF page numbers, migration 0004 (`semantic_sources`, `semantic_chunks`), incremental indexing, exact vector search, and hybrid RRF ranking with the Phase 4 keyword search. Ask Your Memory no longer shows mock answers: it lists cited evidence only. Global search gains a "Related by meaning" group. See `docs/adr/0005-semantic-search.md`.
Real-model tests (`tests/unit/semantic-real.test.ts`, `tests/e2e/semantic.spec.ts`) are skipped unless `MINDSPACE_TEST_MODEL_DIR` points to the model files; mock embeddings are used only in unit tests.
Existing tests changed only where they hard-coded the migration count or the bridge list.
Tested on Linux only. Not tested: Windows, packaged build.

## Phase 6: grounded answers (2026-10-13)
Provider layer (Ollama, Anthropic, OpenAI), encrypted key storage, AI Provider settings with cloud consent, RAG over Phase 5 retrieval with validated `[S#]` citations, streaming/cancel, persistent conversations (migration 0005). See `docs/adr/0006-grounded-answers.md`. Verified with mocked providers only; no real provider request has been made. The Ask retrieval-stage UI of Phase 5 was replaced; E2E semantic checks now call the retrieval bridge directly.

## Phase 8: backup, restore, recovery (2026-10-13)
Single-file `.msbak` backups (optional AES-256-GCM password protection), consistent SQLite snapshots via the online backup API, verification, staged restore with rollback applied at the next start, automatic in-session backups with retention, and a Backup & recovery panel in Settings. See `docs/adr/0007-backup-restore.md`. No schema migration. Phase 7 was never run, so nothing from it exists or is backed up. Verified on Linux only (unit, jsdom UI, Electron E2E including a real restore + restart). Not tested: Windows, real disk-full, real native dialogs (stubbed in E2E).
