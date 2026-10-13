/** Runtime validation for retrieval IPC payloads (main process only; keeps zod out of the renderer). */
import { z } from 'zod'
import { RETRIEVAL_LIMIT_MAX, RETRIEVAL_MODES, RETRIEVAL_SCOPES, RETRIEVAL_TEXT_MAX } from './retrieval'

export const retrievalQuerySchema = z.strictObject({
  text: z.string().max(RETRIEVAL_TEXT_MAX),
  mode: z.enum(RETRIEVAL_MODES).optional(),
  scopes: z.array(z.enum(RETRIEVAL_SCOPES)).min(1).max(RETRIEVAL_SCOPES.length).optional(),
  limit: z.number().int().min(1).max(RETRIEVAL_LIMIT_MAX).optional()
})
