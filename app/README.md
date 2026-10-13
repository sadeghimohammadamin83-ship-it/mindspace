# MINDSPACE (Phase 3: project memory)
npm install, then: `npm run dev` | `npm run typecheck` | `npm test` | `npm run build` | `npm run test:e2e` (needs a display; on Linux use xvfb-run and a non-root user or --no-sandbox).
Notes, tasks, projects, tags, activity and UI preferences are stored in SQLite at `%APPDATA%\MINDSPACE\mindspace.sqlite3` (Electron `userData`). Ask and the Daily Briefing text are still prototypes. No AI, network or API keys.
Tests use temporary databases; E2E sets `MINDSPACE_USER_DATA_DIR` (ignored in packaged builds) so the real profile is never touched.
Phase 3 adds project workspaces, structured decision records, links between notes, tasks, decisions and projects, tag management and a project timeline, all stored in the same database (migration 0002 upgrades Phase 2 databases in place).

Phase 8 adds Backup & recovery (Settings): `.msbak` backups with optional password encryption, verification, staged restore with rollback, automatic in-session backups. See `docs/adr/0007-backup-restore.md`. Backups never contain AI keys.

## Windows release
`npm run release:win` — see [docs/RELEASING.md](docs/RELEASING.md).
