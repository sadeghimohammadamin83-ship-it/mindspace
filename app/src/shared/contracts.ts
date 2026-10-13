/**
 * Runtime contracts for every request the renderer may send to the data layer.
 * The main process parses each IPC payload with these schemas before anything
 * reaches a repository; the renderer only imports the inferred types.
 */
import { z } from 'zod'
import { DECISION_STATUSES, ITEM_KINDS, PROJECT_STATUSES, TASK_PRIORITIES, TASK_STATUSES } from './domain'
import { isValidIsoDate } from './dates'

import { ACTIVITY_PAGE_MAX, BODY_MAX, LINKS_MAX, SEARCH_LIMIT_MAX, TAG_MAX, TAGS_MAX, TITLE_MAX } from './limits'

/** Ids are prefixed slugs or UUIDs, e.g. `task-3f2a…` or `proj-mindspace`. */
export const idSchema = z.string().regex(/^[a-z]{2,8}-[a-z0-9-]{1,80}$/i, 'Invalid id')

const title = z.string().trim().min(1, 'Title is required').max(TITLE_MAX, 'Title is too long')
const body = z.string().max(BODY_MAX, 'Text is too long')
const dueDate = z.string().refine(isValidIsoDate, 'Invalid date').nullable()
const httpUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => {
    try {
      const u = new URL(v)
      return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.')
    } catch {
      return false
    }
  }, 'Invalid URL')
const tagLabels = z.array(z.string().trim().min(1).max(TAG_MAX)).max(TAGS_MAX)

export const itemCreateSchema = z
  .strictObject({
    kind: z.enum(ITEM_KINDS),
    title,
    body,
    url: z.string(),
    tagLabels,
    projectId: idSchema.nullable()
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'link' && !httpUrl.safeParse(v.url).success) {
      ctx.addIssue({ code: 'custom', path: ['url'], message: 'A link needs a valid http(s) URL' })
    }
  })

export const itemPatchSchema = z
  .strictObject({
    title: title.optional(),
    body: body.optional(),
    url: z.union([httpUrl, z.literal('')]).optional(),
    tagLabels: tagLabels.optional(),
    projectId: idSchema.nullable().optional()
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update')

export const itemSearchSchema = z.strictObject({
  text: z.string().max(200),
  kind: z.enum(ITEM_KINDS).optional(),
  tagId: idSchema.optional(),
  projectId: idSchema.optional(),
  limit: z.number().int().min(1).max(SEARCH_LIMIT_MAX).optional()
})

export const projectCreateSchema = z.strictObject({
  name: title,
  description: body,
  status: z.enum(PROJECT_STATUSES)
})

export const projectPatchSchema = projectCreateSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update')

export const taskCreateSchema = z.strictObject({
  title,
  notes: body,
  status: z.enum(TASK_STATUSES),
  priority: z.enum(TASK_PRIORITIES),
  dueDate,
  projectId: idSchema.nullable()
})

export const taskPatchSchema = taskCreateSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update')

export const taskFilterSchema = z.strictObject({
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  projectId: idSchema.optional(),
  limit: z.number().int().min(1).max(SEARCH_LIMIT_MAX).optional()
})

const requiredText = z.string().trim().min(1, 'Required').max(BODY_MAX, 'Text is too long')
const initialDecisionStatus = z.enum(['proposed', 'accepted', 'rejected'])
const idList = z.array(idSchema).max(LINKS_MAX)

export const decisionCreateSchema = z.strictObject({
  title,
  context: body,
  decision: requiredText,
  rationale: body,
  alternatives: body,
  consequences: body,
  status: initialDecisionStatus,
  decidedOn: dueDate,
  projectId: idSchema.nullable(),
  tagLabels,
  noteIds: idList,
  taskIds: idList
})

/** Status and links change through their own operations, so history stays explicit. */
export const decisionPatchSchema = z
  .strictObject({
    title: title.optional(),
    context: body.optional(),
    decision: requiredText.optional(),
    rationale: body.optional(),
    alternatives: body.optional(),
    consequences: body.optional(),
    decidedOn: dueDate.optional(),
    projectId: idSchema.nullable().optional(),
    tagLabels: tagLabels.optional()
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update')

export const decisionStatusSchema = z.strictObject({
  id: idSchema,
  status: z.enum(DECISION_STATUSES),
  supersededById: idSchema.nullable().optional()
})

export const decisionLinkSchema = z.strictObject({
  decisionId: idSchema,
  targetType: z.enum(['item', 'task']),
  targetId: idSchema
})

const tagLabel = z.string().trim().min(1, 'Required').max(TAG_MAX, 'Tag is too long')
export const tagCreateSchema = z.strictObject({ label: tagLabel })
export const tagRenameSchema = z.strictObject({ id: idSchema, label: tagLabel })

export const activityQuerySchema = z.strictObject({
  projectId: idSchema,
  limit: z.number().int().min(1).max(ACTIVITY_PAGE_MAX).optional(),
  /** Return only events older than this timestamp, for "load more". */
  before: z.string().max(40).optional()
})

/** Non-sensitive UI preferences. Unknown keys are rejected, so secrets cannot be stored here. */
export const preferencesSchema = z.strictObject({
  lang: z.enum(['fa', 'en']),
  calendar: z.enum(['persian', 'gregory']),
  reduceMotion: z.boolean(),
  sidebarCollapsed: z.boolean().nullable(),
  defaultCaptureKind: z.enum([...ITEM_KINDS, 'task']),
  showSidebarCounts: z.boolean()
})
export const preferencesPatchSchema = preferencesSchema.partial()

export type ItemCreateInput = z.infer<typeof itemCreateSchema>
export type ItemPatch = z.infer<typeof itemPatchSchema>
export type ItemSearch = z.infer<typeof itemSearchSchema>
export type ProjectCreateInput = z.infer<typeof projectCreateSchema>
export type ProjectPatch = z.infer<typeof projectPatchSchema>
export type TaskCreateInput = z.infer<typeof taskCreateSchema>
export type TaskPatchInput = z.infer<typeof taskPatchSchema>
export type TaskFilter = z.infer<typeof taskFilterSchema>
export type StoredPreferences = z.infer<typeof preferencesSchema>
export type DecisionCreateInput = z.infer<typeof decisionCreateSchema>
export type DecisionPatch = z.infer<typeof decisionPatchSchema>
export type DecisionStatusInput = z.infer<typeof decisionStatusSchema>
export type DecisionLinkInput = z.infer<typeof decisionLinkSchema>
export type ActivityQuery = z.infer<typeof activityQuerySchema>
