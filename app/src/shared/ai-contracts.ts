/** Runtime validation for AI IPC payloads (main process only). */
import { z } from 'zod'
import { API_KEY_MAX, CLOUD_PROVIDERS, MODEL_ID_MAX, PROVIDER_IDS, QUESTION_MAX } from './ai'

const modelId = z
  .string()
  .trim()
  .max(MODEL_ID_MAX)
  // Model ids are tokens such as `name:tag`, `org/name` or `name-1.2`; no spaces or control characters.
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$|^$/, 'Invalid model identifier')

export const settingsPatchSchema = z.strictObject({
  provider: z.enum(PROVIDER_IDS).nullable().optional(),
  ollama: z.strictObject({ baseUrl: z.string().trim().max(200).optional(), model: modelId.optional() }).optional(),
  anthropic: z.strictObject({ model: modelId.optional() }).optional(),
  openai: z.strictObject({ model: modelId.optional() }).optional(),
  cloudAcknowledged: z.strictObject({ anthropic: z.boolean().optional(), openai: z.boolean().optional() }).optional()
})

export const providerSchema = z.enum(PROVIDER_IDS)
export const cloudProviderSchema = z.enum(CLOUD_PROVIDERS)

export const saveKeySchema = z.strictObject({
  provider: cloudProviderSchema,
  // Keys are opaque tokens: no whitespace or control characters. Length-bounded so a paste of a document is rejected.
  key: z.string().trim().min(8).max(API_KEY_MAX).regex(/^[\x21-\x7e]+$/, 'Invalid key format')
})

export const askSchema = z.strictObject({
  conversationId: z.string().regex(/^conv-[a-z0-9-]{8,64}$/).nullable(),
  question: z.string().trim().min(1).max(QUESTION_MAX)
})

export const conversationIdSchema = z.string().regex(/^conv-[a-z0-9-]{8,64}$/)
export const generationIdSchema = z.string().regex(/^gen-[a-z0-9-]{8,64}$/)
