import { mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { AiBridge, AiEvent, ChatMessage } from '@shared/ai'
import { IpcChannel } from '@shared/ipc'
import type { RetrievalResponse } from '@shared/retrieval'
import { createAiServices } from '../../../src/main/ai/ai-services'
import type { SecretCipher } from '../../../src/main/ai/credentials'
import type { LanguageModelProvider } from '../../../src/main/ai/provider'
import { aiHandlers } from '../../../src/main/ipc/ai-handlers'
import { toResultAsync } from '../../../src/main/ipc/document-handlers'
import { closeDatabase, openDatabase } from '../../../src/main/db/connection'
import { extractPdf } from '../../../src/main/documents/extract'
import type { ModelStore } from '../../../src/main/semantic/model-store'
import { createSemanticService } from '../../../src/main/semantic/semantic-service'
import { createDocumentService } from '../../../src/main/services/document-service'
import { createWorkspaceService } from '../../../src/main/services/workspace-service'
import { MOCK_DIMS, MockProvider } from './mock-embeddings'
import { tempDir } from './db'

export const FIX = resolve(__dirname, '../../fixtures/documents')

/** Reversible stand-in for the OS cipher: the stored bytes are not the plaintext. */
export function fakeCipher(available = true): SecretCipher & { failDecrypt: boolean } {
  const c = {
    failDecrypt: false,
    available: async () => available,
    encrypt: async (plain: string) => Buffer.from(`ENC1:${[...plain].reverse().join('')}`.split('').map((ch) => String.fromCharCode(ch.charCodeAt(0) ^ 7)).join('')),
    decrypt: async (data: Buffer) => {
      if (c.failDecrypt) throw new Error('cannot decrypt')
      const s = [...data.toString('utf8')].map((ch) => String.fromCharCode(ch.charCodeAt(0) ^ 7)).join('')
      if (!s.startsWith('ENC1:')) throw new Error('bad data')
      return { plain: [...s.slice(5)].reverse().join(''), reencrypt: false }
    }
  }
  return c
}

export interface Harness {
  tmp: ReturnType<typeof tempDir>
  db: import('better-sqlite3').Database
  ws: ReturnType<typeof createWorkspaceService>
  docs: ReturnType<typeof createDocumentService>
  sem: ReturnType<typeof createSemanticService>
  services: Awaited<ReturnType<typeof createAiServices>>
  events: AiEvent[]
  makeCalls: string[]
  emit: (e: AiEvent) => void
  waitDone: (generationId: string) => Promise<ChatMessage>
  note: (title: string, body: string) => Promise<string>
  importPdf: (name?: string) => Promise<string>
  ask: (question: string, conversationId?: string | null) => Promise<{ generationId: string; conversationId: string; message: ChatMessage }>
  close: () => Promise<void>
}

const installedStore: ModelStore = { dir: '/nonexistent', totalBytes: 0, isInstalled: async () => true, verify: async () => true, download: async () => undefined }

/** A real (temporary) database with the real Phase 4/5 services, mock embeddings and a scripted provider. */
export async function aiHarness(opts: { provider?: () => LanguageModelProvider; cipher?: SecretCipher; retrieve?: (q: unknown) => Promise<RetrievalResponse> } = {}): Promise<Harness> {
  const tmp = tempDir()
  const docsDir = join(tmp.dir, 'documents')
  mkdirSync(docsDir)
  const db = openDatabase(tmp.file)
  const provider = new MockProvider()
  const sem = createSemanticService({
    db,
    store: installedStore,
    createProvider: () => provider,
    model: { modelId: provider.info.modelId, displayName: 'mock', license: 'test', dimensions: MOCK_DIMS, source: 'test' },
    tuning: { minScore: 0.5, margin: 0.5 },
    debounceMs: 0
  })
  const ws = createWorkspaceService(db)
  let picks: string[] | null = null
  const docs = createDocumentService({
    db,
    dir: docsDir,
    selectFiles: async () => picks,
    extractPdf: async (p) => extractPdf(new Uint8Array(readFileSync(p))),
    onChange: () => sem.notifyChanged()
  })
  const makeCalls: string[] = []
  const services = await createAiServices({
    db,
    userDataDir: tmp.dir,
    cipher: opts.cipher ?? fakeCipher(),
    retrieve: opts.retrieve ?? ((q) => sem.retrieve(q)),
    ...(opts.provider
      ? {
          makeProvider: (_s, id) => {
            makeCalls.push(id)
            return opts.provider!()
          }
        }
      : {})
  })
  const events: AiEvent[] = []
  const emit = (e: AiEvent) => void events.push(e)
  const waitDone = async (generationId: string): Promise<ChatMessage> => {
    for (let i = 0; i < 400; i++) {
      const end = events.find((e) => e.generationId === generationId && (e.type === 'done' || e.type === 'error' || e.type === 'cancelled'))
      if (end && 'message' in end) return end.message
      await new Promise((r) => setTimeout(r, 5))
    }
    throw new Error('generation did not finish')
  }
  return {
    tmp,
    db,
    ws,
    docs,
    sem,
    services,
    events,
    makeCalls,
    emit,
    waitDone,
    async note(title: string, body: string) {
      const c = ws.createItem({ kind: 'note', title, body, url: '', tagLabels: [], projectId: null })
      await sem.idle()
      return c.items[0]!.id
    },
    async importPdf(name = 'sample-semantic.pdf') {
      picks = [join(FIX, name)]
      const r = await docs.importDocuments()
      await docs.idle()
      await sem.idle()
      if (r.cancelled || r.results[0]!.outcome === 'rejected') throw new Error('import failed')
      return r.results[0]!.document.id
    },
    async ask(question: string, conversationId: string | null = null) {
      const started = await services.answers.ask({ conversationId, question }, emit)
      const message = await waitDone(started.generationId)
      return { ...started, message }
    },
    async close() {
      await services.answers.cancelAll()
      await sem.close()
      closeDatabase(db)
      tmp.cleanup()
    }
  }
}


/** The renderer's AiBridge wired to the real handlers, with structured cloning standing in for IPC. */
export function aiBridgeFor(services: () => Promise<Awaited<ReturnType<typeof createAiServices>>>): AiBridge {
  const listeners = new Set<(e: AiEvent) => void>()
  const handlers = aiHandlers(services, (_ev, e) => {
    const copy = structuredClone(e)
    // Events travel on their own channel and arrive asynchronously, never inside the invoke result.
    queueMicrotask(() => listeners.forEach((l) => l(copy)))
  })
  const C = IpcChannel
  const call = async (channel: string, arg?: unknown) => structuredClone(await toResultAsync(() => handlers[channel]!({} as never, ...(arg === undefined ? [] : [structuredClone(arg)]))))
  return {
    getSettings: () => call(C.aiGetSettings),
    updateSettings: (p) => call(C.aiUpdateSettings, p),
    saveKey: (i) => call(C.aiSaveKey, i),
    removeKey: (p) => call(C.aiRemoveKey, p),
    testConnection: (p) => call(C.aiTest, p),
    ask: (r) => call(C.aiAsk, r),
    cancel: (id) => call(C.aiCancel, id),
    listConversations: () => call(C.aiListConversations),
    getConversation: (id) => call(C.aiGetConversation, id),
    deleteConversation: (id) => call(C.aiDeleteConversation, id),
    onEvent(l) {
      listeners.add(l)
      return () => void listeners.delete(l)
    }
  } as AiBridge
}
