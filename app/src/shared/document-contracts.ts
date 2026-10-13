/** Runtime validation for document/search IPC payloads (main process only; keeps zod out of the renderer). */
import { z } from 'zod'
import { SEARCH_PAGE_MAX, SEARCH_SCOPES, SEARCH_TEXT_MAX } from './documents'

export const searchQuerySchema = z.strictObject({
  text: z.string().max(SEARCH_TEXT_MAX),
  scopes: z.array(z.enum(SEARCH_SCOPES)).max(SEARCH_SCOPES.length).optional(),
  limit: z.number().int().min(1).max(SEARCH_PAGE_MAX).optional(),
  offset: z.number().int().min(0).max(10_000).optional()
})

export const documentIdSchema = z.string().regex(/^doc-[a-f0-9-]{36}$/, 'Invalid id')
export const pageRequestSchema = z.strictObject({ id: documentIdSchema, page: z.number().int().min(1).max(100_000) })

