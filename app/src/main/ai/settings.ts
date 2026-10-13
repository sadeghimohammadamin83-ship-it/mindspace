/**
 * Non-secret AI settings (provider choice, model ids, Ollama address, consent
 * flags) in the `ai_settings` table. API keys live in credentials.ts only.
 * Everything is validated on the way in and re-validated on the way out, so a
 * hand-edited row can never produce an unsafe endpoint or provider state.
 */
import { z } from 'zod'
import { OLLAMA_DEFAULT_URL, PROVIDER_IDS, type AiSettings, type AiSettingsPatch, type AiSettingsView } from '@shared/ai'
import { settingsPatchSchema } from '@shared/ai-contracts'
import type { ConversationsRepo } from '../db/repositories/conversations'
import { DataError } from '../services/workspace-service'
import type { CredentialStore } from './credentials'
import { parseOllamaUrl } from './ollama'
import { ProviderError } from './provider'

const stored = z.object({
  provider: z.enum(PROVIDER_IDS).nullable().catch(null),
  ollama: z.object({ baseUrl: z.string().catch(OLLAMA_DEFAULT_URL), model: z.string().max(200).catch('') }).catch({ baseUrl: OLLAMA_DEFAULT_URL, model: '' }),
  anthropic: z.object({ model: z.string().max(200).catch('') }).catch({ model: '' }),
  openai: z.object({ model: z.string().max(200).catch('') }).catch({ model: '' }),
  cloudAcknowledged: z.object({ anthropic: z.boolean().catch(false), openai: z.boolean().catch(false) }).catch({ anthropic: false, openai: false })
})

export const DEFAULT_SETTINGS: AiSettings = {
  provider: null,
  ollama: { baseUrl: OLLAMA_DEFAULT_URL, model: '' },
  anthropic: { model: '' },
  openai: { model: '' },
  cloudAcknowledged: { anthropic: false, openai: false }
}

export function createAiSettings(repo: ConversationsRepo, credentials: CredentialStore) {
  function load(): AiSettings {
    const raw = repo.getSettingsJson()
    if (!raw) return structuredClone(DEFAULT_SETTINGS)
    try {
      const s = stored.parse(JSON.parse(raw)) as AiSettings
      // A stored non-loopback address is dropped, not trusted.
      try {
        parseOllamaUrl(s.ollama.baseUrl)
      } catch {
        s.ollama.baseUrl = OLLAMA_DEFAULT_URL
      }
      return s
    } catch {
      return structuredClone(DEFAULT_SETTINGS)
    }
  }

  async function view(): Promise<AiSettingsView> {
    return {
      ...load(),
      credentials: { anthropic: credentials.info('anthropic'), openai: credentials.info('openai') },
      encryptionAvailable: await credentials.encryptionAvailable()
    }
  }

  return {
    load,
    view,
    async update(patchInput: unknown): Promise<AiSettingsView> {
      const r = settingsPatchSchema.safeParse(patchInput)
      if (!r.success) throw new DataError('validation', 'Invalid settings')
      const p = r.data as AiSettingsPatch
      const next = load()
      if (p.ollama?.baseUrl !== undefined) {
        try {
          next.ollama.baseUrl = parseOllamaUrl(p.ollama.baseUrl)
        } catch (e) {
          throw new DataError('validation', e instanceof ProviderError ? e.message : 'Invalid address', { baseUrl: 'invalid' })
        }
      }
      if (p.ollama?.model !== undefined) next.ollama.model = p.ollama.model
      if (p.anthropic?.model !== undefined) next.anthropic.model = p.anthropic.model
      if (p.openai?.model !== undefined) next.openai.model = p.openai.model
      if (p.cloudAcknowledged?.anthropic !== undefined) next.cloudAcknowledged.anthropic = p.cloudAcknowledged.anthropic
      if (p.cloudAcknowledged?.openai !== undefined) next.cloudAcknowledged.openai = p.cloudAcknowledged.openai
      if (p.provider !== undefined) next.provider = p.provider
      // Selecting a cloud provider requires the user's explicit acknowledgement that data leaves this computer.
      if (next.provider && next.provider !== 'ollama' && !next.cloudAcknowledged[next.provider]) {
        // Choosing a cloud provider without consent is refused; withdrawing consent deselects it.
        if (p.provider) throw new DataError('validation', 'Confirm the data-transfer notice before using a cloud provider.', { ai: 'consent_required' })
        next.provider = null
      }
      repo.putSettingsJson(JSON.stringify(next))
      return view()
    }
  }
}
export type AiSettingsService = ReturnType<typeof createAiSettings>
