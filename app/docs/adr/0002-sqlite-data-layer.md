# ADR 0002: SQLite data layer (Phase 2)

Status: accepted, 2026-10-12

## Decision
- Driver: **better-sqlite3 13.0.3** (Phase 0 ADR-2). Version 13 is built on Node-API (NAPI v10) and ships prebuilt binaries for win32-x64, win32-arm64, linux and macOS inside the npm package, so the same `.node` file loads in plain Node (unit tests) and in Electron 44 without `electron-rebuild`. Verified on Linux: loads under Node 22 and under `ELECTRON_RUN_AS_NODE` Electron 44.7.0 (Node 24.21).
- File: `app.getPath('userData')/mindspace.sqlite3`. WAL, `foreign_keys=ON`, `busy_timeout=3000`, `quick_check` on open.
- Migrations: append-only list in `src/main/db/migrations/`, tracked in `schema_migrations`; each migration and its version row commit in one transaction; a database with a newer version than the app knows is refused. Nothing ever drops, resets or deletes the file; failures surface as an error dialog plus an in-app error screen.
- Layers: `db/` (connection, migrations, repositories, seed) → `services/workspace-service.ts` (Zod validation, business rules, transactions, ChangeSet) → `ipc/data-handlers.ts` (sender check, result envelope) → `preload` (`window.mindspace.data`, fixed named methods) → renderer `state/workspace.tsx` (cache updated only from committed ChangeSets).
- Validation: Zod 4 (approved in Phase 0), schemas in `src/shared/contracts.ts`; the renderer imports only types, so Zod is not in the renderer bundle.
- Sample data is inserted once into a brand-new empty database (flag `app_meta.sample_seeded`), never over user data.

## Not done here
FTS5, embeddings, backups (Phase 0 recommends a backup before each migration; deferred because backups are out of Phase 2 scope), packaging.
