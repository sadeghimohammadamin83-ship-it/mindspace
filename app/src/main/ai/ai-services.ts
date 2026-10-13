/** Wires the AI services for the running app: settings, credentials and the answer service. */
import { join } from 'node:path'
import type { Database } from 'better-sqlite3'
import type { RetrievalResponse } from '@shared/retrieval'
import { createConversationsRepo } from '../db/repositories/conversations'
import { createSemanticRepo } from '../db/repositories/semantic'
import { createAnswerService, type AnswerDeps } from './answer-service'
import { createCredentialStore, electronCipher, type CredentialStore, type SecretCipher } from './credentials'
import { createAiSettings } from './settings'

export const CREDENTIALS_FILE = 'ai-credentials.json'

export interface AiServices {
  answers: ReturnType<typeof createAnswerService>
  settings: ReturnType<typeof createAiSettings>
  credentials: CredentialStore
}

export async function createAiServices(opts: {
  db: Database
  userDataDir: string
  retrieve: (query: unknown) => Promise<RetrievalResponse>
  cipher?: SecretCipher
  makeProvider?: AnswerDeps['makeProvider']
}): Promise<AiServices> {
  const conversations = createConversationsRepo(opts.db)
  const credentials = await createCredentialStore(join(opts.userDataDir, CREDENTIALS_FILE), opts.cipher ?? (await electronCipher()))
  const settings = createAiSettings(conversations, credentials)
  const answers = createAnswerService({
    conversations,
    semanticRepo: createSemanticRepo(opts.db),
    retrieve: opts.retrieve,
    settings,
    credentials,
    ...(opts.makeProvider ? { makeProvider: opts.makeProvider } : {})
  })
  return { answers, settings, credentials }
}
