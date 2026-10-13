import { z } from 'zod'
import { BACKUP_PASSWORD_MAX, RETENTION_MAX, RETENTION_MIN } from './backup'

const password = z.string().max(BACKUP_PASSWORD_MAX)
const id = z.string().regex(/^[a-f0-9]{32}$/)

export const configPatchSchema = z
  .object({
    autoEnabled: z.boolean(),
    frequency: z.enum(['daily', 'weekly']),
    keepAuto: z.number().int().min(RETENTION_MIN).max(RETENTION_MAX)
  })
  .partial()
  .strict()
export const createSchema = z.object({ password: password.optional() }).strict()
export const selectSchema = z.object({ recordId: id.optional() }).strict()
export const inspectSchema = z.object({ token: id, password: password.optional() }).strict()
export const verifyRecordSchema = z.object({ recordId: id, password: password.optional() }).strict()
export const restoreSchema = z.object({ token: id }).strict()
export const recordIdSchema = id
