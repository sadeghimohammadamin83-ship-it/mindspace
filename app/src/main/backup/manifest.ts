import { z } from 'zod'
import type { BackupCounts } from '@shared/backup'

const sha256 = z.string().regex(/^[a-f0-9]{64}$/)

export const countsSchema: z.ZodType<BackupCounts> = z.object({
  notes: z.number().int().nonnegative(),
  projects: z.number().int().nonnegative(),
  tasks: z.number().int().nonnegative(),
  decisions: z.number().int().nonnegative(),
  tags: z.number().int().nonnegative(),
  documents: z.number().int().nonnegative(),
  conversations: z.number().int().nonnegative(),
  semanticChunks: z.number().int().nonnegative()
})

/**
 * Manifest v1. `formatVersion` describes this container/manifest layout and
 * changes only when the backup format itself changes. `database.schemaVersion`
 * is the migration level of the snapshot and changes with the app's schema.
 * No secret of any kind is ever written here.
 */
export const manifestSchema = z.object({
  format: z.literal('mindspace-backup'),
  formatVersion: z.number().int().positive(),
  createdAt: z.string().max(40),
  kind: z.enum(['manual', 'auto', 'safety']),
  app: z.object({ name: z.string().max(100), version: z.string().max(40) }),
  platform: z.string().max(20),
  encrypted: z.boolean(),
  database: z.object({
    schemaVersion: z.number().int().nonnegative(),
    method: z.string().max(100),
    sqliteVersion: z.string().max(40),
    journalModeAtBackup: z.string().max(20)
  }),
  counts: countsSchema,
  components: z.array(z.object({ id: z.string().max(40), included: z.boolean(), note: z.string().max(400) })).max(20),
  files: z
    .array(z.object({ path: z.string().max(400), size: z.number().int().nonnegative(), sha256, component: z.enum(['database', 'documents']) }))
    .max(20_000),
  compatibility: z.object({
    minReaderFormat: z.number().int().positive(),
    /** A restoring app must know at least this schema version, or it refuses. */
    restoreNeedsSchemaAtLeast: z.number().int().nonnegative(),
    note: z.string().max(400)
  })
})
export type Manifest = z.infer<typeof manifestSchema>

/** What each data store is, and why it is or is not in the backup. Shown to the user and stored in every manifest. */
export const COMPONENT_NOTES = {
  database: 'Notes, projects, tasks, decisions, tags, links, activity, preferences, AI conversations (without keys), document text and pages, the full-text index and semantic chunks with their embeddings. One consistent SQLite snapshot.',
  documents: 'The managed copies of imported documents.',
  credentials: 'AI provider keys are never included. They are tied to this Windows account; enter them again after restoring.',
  models: 'The downloaded embedding model is not included (large, re-downloadable). Semantic search needs it installed again on a new computer; the stored embeddings are kept.',
  caches: 'Temporary files and old backups are not included.'
} as const
