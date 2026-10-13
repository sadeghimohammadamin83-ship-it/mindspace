# ADR 0003: Project memory, decisions and relationships (Phase 3)

Status: accepted, 2026-10-12

## Decision
- **Decisions are a new first-class table** (`decisions`), not the existing `items.kind = 'decision'`. Those legacy items are plain notes with a "decision" label; they are left untouched (no data was converted) and still appear in the Library. Structured records need required fields, a status lifecycle and a replacement pointer, which a free-text item cannot constrain.
- **Status model**: `proposed`, `accepted`, `rejected`, `superseded`. Allowed changes live in one place, `DECISION_TRANSITIONS` (`src/shared/domain.ts`), and the service enforces them. Status and links change through their own operations (`setDecisionStatus`, `linkDecision`), not through the edit patch, so each change leaves an explicit event.
- **Superseding** keeps the old row and all its text and links. It requires a replacement (`superseded_by`), refuses itself, a rejected replacement and replacement loops. If the replacement is later deleted, `superseded_by` becomes NULL (ON DELETE SET NULL) and the decision stays `superseded`; the UI says the replacement was deleted.
- **Relationships**
  - One-to-many kept as Phase 2 built it: `items.project_id`, `tasks.project_id`, and now `decisions.project_id`, all nullable, ON DELETE SET NULL. A note belongs to at most one project; "unlink" sets it to NULL and never deletes the note.
  - Many-to-many junction tables with composite primary keys and ON DELETE CASCADE on both sides: `decision_items` (notes), `decision_tasks`, `decision_tags`. Existing `item_tags` is reused for notes. Deleting a note, task, decision or tag removes only link rows.
  - Tags are supported on notes and decisions. Tasks and projects have no tags in this phase.
- **Tag identity**: two labels are one tag when `normalizeText` of them is equal (case, spacing, Persian/Arabic yeh and kaf, digits, ZWNJ; a leading `#` is dropped). `tags.label_key` is UNIQUE so the database enforces it. Rename refuses a name another tag already has (conflict); deleting a tag removes only its links.
- **Activity**: the existing `activity_events` table is extended, not replaced by a second table: new `project_id` (for the project timeline, indexed with `at`) and `meta` (JSON, only `{related:{type,id,title}}`), 14 new event kinds, and the `decision` ref type. SQLite cannot change a CHECK constraint, so migration 0002 rebuilds the table by copy inside its transaction; all rows are kept and `project_id` is back-filled from the record each event points at. Events are written by the service in the same transaction as the change; React never invents events. Updates that change nothing write nothing. Events are removed with the record they describe (Phase 2 rule); a related record's title is stored in `meta`, so a link event stays readable after the other side is deleted, and the UI shows it as plain text rather than a dead link.
- **API surface**: ten new named IPC operations (decision create/update/delete/status/link/unlink, tag create/rename/delete, project activity), each validated by strict Zod schemas in `contracts.ts`. No operation accepts SQL, a table name or a file path. The project timeline is read straight from the database (limit 1 to 100, `before` cursor); everything else flows through the existing ChangeSet cache.

## Not done here
Tags on tasks or projects, deleting tasks/notes from the UI, merging tags, sample decisions for databases created before Phase 3, converting legacy `decision` notes into records, search over decisions in the global search box.
