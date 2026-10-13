/**
 * Phase 6: grounded answer generation. Types shared by main, preload and
 * renderer. The renderer never sees an API key and never builds a source link
 * itself: every citation it renders comes from `AnswerSource`, which the main
 * process built from the evidence it actually sent to the model.
 */
import type { DataResult } from './ipc'

export const PROVIDER_IDS = ['ollama', 'anthropic', 'openai'] as const
export type ProviderId = (typeof PROVIDER_IDS)[number]
export const CLOUD_PROVIDERS = ['anthropic', 'openai'] as const
export type CloudProviderId = (typeof CLOUD_PROVIDERS)[number]
export const isCloudProvider = (p: ProviderId): p is CloudProviderId => p !== 'ollama'

export const QUESTION_MAX = 1000
export const MODEL_ID_MAX = 200
export const API_KEY_MAX = 512
export const OLLAMA_DEFAULT_URL = 'http://127.0.0.1:11434'

/** Error classes a provider (or the pipeline around it) can report. Messages never contain keys or stack traces. */
export type AiErrorCode =
  | 'not_configured'
  | 'consent_required'
  | 'auth'
  | 'rate_limit'
  | 'timeout'
  | 'network'
  | 'unavailable'
  | 'model_not_found'
  | 'bad_response'
  | 'empty_response'
  | 'refused'
  | 'retrieval_failed'
  | 'busy'
  | 'invalid_request'
  | 'internal'

export type CredentialState = 'none' | 'configured' | 'unreadable'

export interface CredentialInfo {
  state: CredentialState
  /** ISO time the key was last saved. Never the key itself, not even a fragment. */
  updatedAt: string | null
}

export interface AiSettings {
  /** The provider used by Ask. Null until the user picks one. */
  provider: ProviderId | null
  ollama: { baseUrl: string; model: string }
  anthropic: { model: string }
  openai: { model: string }
  /** The user has read and accepted that questions and retrieved passages are sent to this provider. */
  cloudAcknowledged: { anthropic: boolean; openai: boolean }
}

export interface AiSettingsView extends AiSettings {
  credentials: { anthropic: CredentialInfo; openai: CredentialInfo }
  /** False when the OS cannot protect stored keys; saving a key is then refused (no plaintext fallback). */
  encryptionAvailable: boolean
}

export interface AiSettingsPatch {
  provider?: ProviderId | null
  ollama?: { baseUrl?: string; model?: string }
  anthropic?: { model?: string }
  openai?: { model?: string }
  cloudAcknowledged?: { anthropic?: boolean; openai?: boolean }
}

export interface ConnectionTestResult {
  provider: ProviderId
  ok: boolean
  code: AiErrorCode | null
  /** The model that was checked, when one is configured. */
  model: string
  /** True when the configured model exists for this account/install. Null when it could not be checked. */
  modelAvailable: boolean | null
  /** Model identifiers the provider reported (possibly truncated). */
  models: string[]
  checkedAt: string
  latencyMs: number
}

export interface UsageInfo {
  inputTokens: number | null
  outputTokens: number | null
}

export type FinishReason = 'stop' | 'length' | 'refusal' | 'other'

export interface AnswerSource {
  /** Stable id inside the response: S1, S2, … Only these can be cited. */
  ref: string
  kind: 'note' | 'pdf_page' | 'document'
  /** `item` for notes/ideas/links/decisions-as-notes, `document` for imported files. */
  entity: 'item' | 'document'
  id: string
  /** Note kind (note, idea, link, decision) for items. */
  itemKind: string | null
  title: string
  /** One-based, PDF only. */
  page: number | null
  /** The passage that was actually sent to the model (bounded). */
  excerpt: string
  /** Filled on read: false when the record or page no longer exists. */
  available?: boolean
}

export interface AnswerCheck {
  validCitations: number
  /** Unknown source ids the model produced. They were never turned into links. */
  invalidCitations: string[]
  /** Sentences that make a statement but carry no citation. Not a verdict on correctness. */
  uncitedSentences: number
}

export type MessageStatus = 'complete' | 'cancelled' | 'error'

export interface ChatMessage {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  status: MessageStatus
  createdAt: string
  /** Assistant only. */
  errorCode?: AiErrorCode | null
  provider?: ProviderId | null
  model?: string | null
  finish?: FinishReason | null
  usage?: UsageInfo | null
  durationMs?: number | null
  /** True when no model was called because retrieval found nothing relevant. */
  noEvidence?: boolean
  semanticAvailable?: boolean | null
  sources?: AnswerSource[]
  check?: AnswerCheck | null
}

export interface ConversationSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

export interface ConversationDetail extends ConversationSummary {
  messages: ChatMessage[]
}

export type AiEvent =
  | { generationId: string; conversationId: string; type: 'started'; userMessage: ChatMessage }
  | { generationId: string; conversationId: string; type: 'retrieved'; sources: AnswerSource[]; semanticAvailable: boolean; indexIncomplete: boolean }
  | { generationId: string; conversationId: string; type: 'delta'; text: string }
  | { generationId: string; conversationId: string; type: 'done'; message: ChatMessage }
  | { generationId: string; conversationId: string; type: 'cancelled'; message: ChatMessage }
  | { generationId: string; conversationId: string; type: 'error'; code: AiErrorCode; message: ChatMessage }

export interface AskRequest {
  /** Null starts a new conversation. */
  conversationId: string | null
  question: string
}

export interface AskStarted {
  generationId: string
  conversationId: string
}

export interface AiBridge {
  getSettings(): Promise<DataResult<AiSettingsView>>
  updateSettings(patch: AiSettingsPatch): Promise<DataResult<AiSettingsView>>
  /** Stores the key encrypted in the main process. The key is not returned or kept by the renderer. */
  saveKey(input: { provider: CloudProviderId; key: string }): Promise<DataResult<AiSettingsView>>
  removeKey(provider: CloudProviderId): Promise<DataResult<AiSettingsView>>
  testConnection(provider: ProviderId): Promise<DataResult<ConnectionTestResult>>
  ask(req: AskRequest): Promise<DataResult<AskStarted>>
  cancel(generationId: string): Promise<DataResult<null>>
  listConversations(): Promise<DataResult<ConversationSummary[]>>
  getConversation(id: string): Promise<DataResult<ConversationDetail>>
  deleteConversation(id: string): Promise<DataResult<null>>
  /** Subscribes to generation events. Returns the unsubscribe function. */
  onEvent(listener: (event: AiEvent) => void): () => void
}
