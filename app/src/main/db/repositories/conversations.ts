/**
 * Conversations, messages and AI settings (migration 0005). Citations are
 * stored as a snapshot of the sources that were actually supplied to the
 * model and cited; availability is resolved against live records on read.
 */
import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type { AiErrorCode, AnswerCheck, AnswerSource, ChatMessage, ConversationDetail, ConversationSummary, FinishReason, MessageStatus, ProviderId, UsageInfo } from '@shared/ai'

interface MessageRow {
  id: string
  conversation_id: string
  seq: number
  role: 'user' | 'assistant'
  content: string
  status: MessageStatus
  error_code: string | null
  provider: ProviderId | null
  model: string | null
  finish: FinishReason | null
  input_tokens: number | null
  output_tokens: number | null
  duration_ms: number | null
  no_evidence: number
  semantic_available: number | null
  sources_json: string | null
  check_json: string | null
  created_at: string
}

export interface NewMessage {
  role: 'user' | 'assistant'
  content: string
  status?: MessageStatus
  errorCode?: AiErrorCode | null
  provider?: ProviderId | null
  model?: string | null
  finish?: FinishReason | null
  usage?: UsageInfo | null
  durationMs?: number | null
  noEvidence?: boolean
  semanticAvailable?: boolean | null
  sources?: AnswerSource[]
  check?: AnswerCheck | null
}

const json = <T>(text: string | null): T | undefined => {
  if (!text) return undefined
  try {
    return JSON.parse(text) as T
  } catch {
    return undefined
  }
}

export function toMessage(r: MessageRow): ChatMessage {
  const m: ChatMessage = { id: r.id, conversationId: r.conversation_id, role: r.role, content: r.content, status: r.status, createdAt: r.created_at }
  if (r.role === 'assistant') {
    m.errorCode = (r.error_code as AiErrorCode | null) ?? null
    m.provider = r.provider
    m.model = r.model
    m.finish = r.finish
    m.usage = r.input_tokens === null && r.output_tokens === null ? null : { inputTokens: r.input_tokens, outputTokens: r.output_tokens }
    m.durationMs = r.duration_ms
    m.noEvidence = r.no_evidence === 1
    m.semanticAvailable = r.semantic_available === null ? null : r.semantic_available === 1
    m.sources = json<AnswerSource[]>(r.sources_json) ?? []
    m.check = json<AnswerCheck>(r.check_json) ?? null
  }
  return m
}

export function createConversationsRepo(db: Database) {
  const q = {
    conv: db.prepare<[string], { id: string; title: string; created_at: string; updated_at: string }>('SELECT * FROM conversations WHERE id = ?'),
    list: db.prepare<[], { id: string; title: string; created_at: string; updated_at: string; n: number }>(
      `SELECT c.id, c.title, c.created_at, c.updated_at, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS n
         FROM conversations c ORDER BY c.updated_at DESC, c.id LIMIT 200`
    ),
    messages: db.prepare<[string], MessageRow>('SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq'),
    nextSeq: db.prepare<[string], { n: number }>('SELECT COALESCE(MAX(seq) + 1, 0) AS n FROM messages WHERE conversation_id = ?'),
    insConv: db.prepare('INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)'),
    touch: db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?'),
    delConv: db.prepare('DELETE FROM conversations WHERE id = ?'),
    ins: db.prepare(
      `INSERT INTO messages (id, conversation_id, seq, role, content, status, error_code, provider, model, finish, input_tokens, output_tokens,
         duration_ms, no_evidence, semantic_available, sources_json, check_json, created_at)
       VALUES (@id, @conversation_id, @seq, @role, @content, @status, @error_code, @provider, @model, @finish, @input_tokens, @output_tokens,
         @duration_ms, @no_evidence, @semantic_available, @sources_json, @check_json, @created_at)`
    ),
    getSetting: db.prepare<[string], { value: string }>('SELECT value FROM ai_settings WHERE key = ?'),
    putSetting: db.prepare('INSERT INTO ai_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'),
    itemExists: db.prepare<[string], { x: number }>('SELECT 1 AS x FROM items WHERE id = ?'),
    docExists: db.prepare<[string], { format: string }>('SELECT format FROM documents WHERE id = ?'),
    pageExists: db.prepare<[string, number], { x: number }>('SELECT 1 AS x FROM document_pages WHERE document_id = ? AND page_no = ?')
  }

  const summary = (c: { id: string; title: string; created_at: string; updated_at: string }, n: number): ConversationSummary => ({
    id: c.id,
    title: c.title,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    messageCount: n
  })

  /** A cited source is available only if the record (and, for PDFs, the page) still exists. */
  function isAvailable(s: AnswerSource): boolean {
    if (s.entity === 'item') return !!q.itemExists.get(s.id)
    const d = q.docExists.get(s.id)
    if (!d) return false
    return s.page === null || !!q.pageExists.get(s.id, s.page)
  }

  return {
    createConversation(title: string, now: string): string {
      const id = `conv-${randomUUID()}`
      q.insConv.run(id, title.replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled', now, now)
      return id
    },
    exists: (id: string) => !!q.conv.get(id),
    addMessage(conversationId: string, m: NewMessage, now: string): ChatMessage {
      const id = `msg-${randomUUID()}`
      const seq = q.nextSeq.get(conversationId)!.n
      q.ins.run({
        id,
        conversation_id: conversationId,
        seq,
        role: m.role,
        content: m.content,
        status: m.status ?? 'complete',
        error_code: m.errorCode ?? null,
        provider: m.provider ?? null,
        model: m.model ?? null,
        finish: m.finish ?? null,
        input_tokens: m.usage?.inputTokens ?? null,
        output_tokens: m.usage?.outputTokens ?? null,
        duration_ms: m.durationMs ?? null,
        no_evidence: m.noEvidence ? 1 : 0,
        semantic_available: m.semanticAvailable === undefined || m.semanticAvailable === null ? null : m.semanticAvailable ? 1 : 0,
        sources_json: m.sources?.length ? JSON.stringify(m.sources.map(({ available: _a, ...s }) => s)) : null,
        check_json: m.check ? JSON.stringify(m.check) : null,
        created_at: now
      })
      q.touch.run(now, conversationId)
      return toMessage(db.prepare<[string], MessageRow>('SELECT * FROM messages WHERE id = ?').get(id)!)
    },
    list(): ConversationSummary[] {
      return q.list.all().map((c) => summary(c, c.n))
    },
    /** Messages in order, with each cited source's availability resolved against live records. */
    get(id: string): ConversationDetail | null {
      const c = q.conv.get(id)
      if (!c) return null
      const messages = q.messages.all(id).map(toMessage)
      for (const m of messages) m.sources?.forEach((s) => (s.available = isAvailable(s)))
      return { ...summary(c, messages.length), messages }
    },
    /** Completed question/answer pairs only (cancelled, failed and no-evidence turns are not replayed to the model). */
    history(id: string): { role: 'user' | 'assistant'; content: string }[] {
      const rows = q.messages.all(id)
      const out: { role: 'user' | 'assistant'; content: string }[] = []
      for (let i = 0; i + 1 < rows.length; i++) {
        const u = rows[i]!
        const a = rows[i + 1]!
        if (u.role === 'user' && a.role === 'assistant' && a.status === 'complete' && !a.no_evidence) {
          out.push({ role: 'user', content: u.content }, { role: 'assistant', content: a.content })
          i++
        }
      }
      return out
    },
    delete: (id: string) => q.delConv.run(id).changes > 0,
    getSettingsJson: () => q.getSetting.get('settings')?.value ?? null,
    putSettingsJson: (value: string) => void q.putSetting.run('settings', value)
  }
}
export type ConversationsRepo = ReturnType<typeof createConversationsRepo>
