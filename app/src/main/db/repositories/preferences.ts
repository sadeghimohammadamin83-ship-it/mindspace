import type { Database } from 'better-sqlite3'
import { preferencesSchema, type StoredPreferences } from '@shared/contracts'

const KEYS = Object.keys(preferencesSchema.shape) as (keyof StoredPreferences)[]

/**
 * Key/value store for the allowlisted UI preferences. Values are JSON. A stored
 * value that no longer validates is ignored (the UI falls back to its default)
 * rather than crashing start-up.
 */
export function createPreferencesRepo(db: Database) {
  const q = {
    all: db.prepare<[], { key: string; value: string }>('SELECT key, value FROM preferences'),
    upsert: db.prepare(
      'INSERT INTO preferences (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'
    )
  }
  return {
    getAll(): Partial<StoredPreferences> {
      const out: Record<string, unknown> = {}
      for (const { key, value } of q.all.all()) {
        if (!(KEYS as string[]).includes(key)) continue
        try {
          const parsed = preferencesSchema.shape[key as keyof StoredPreferences].safeParse(JSON.parse(value))
          if (parsed.success) out[key] = parsed.data
        } catch {
          // Malformed JSON: ignore this key.
        }
      }
      return out as Partial<StoredPreferences>
    },
    set(patch: Partial<StoredPreferences>): void {
      for (const key of KEYS) {
        if (key in patch) q.upsert.run(key, JSON.stringify(patch[key]))
      }
    }
  }
}
