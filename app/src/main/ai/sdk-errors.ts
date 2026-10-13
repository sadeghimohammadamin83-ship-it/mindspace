/** Shared mapping from official-SDK errors (Anthropic, OpenAI share the same class names) to ProviderError. */
import { errorForStatus, ProviderError, safeDetail } from './provider'

interface SdkLikeError {
  name?: string
  status?: number
  message?: string
  error?: { message?: unknown; error?: { message?: unknown } } | null
}

export function mapSdkError(err: unknown, secrets: readonly string[], cancelled: boolean): ProviderError | null {
  if (err instanceof ProviderError) return err
  if (cancelled) return null
  const e = (err ?? {}) as SdkLikeError
  if (e.name === 'APIUserAbortError') return null
  if (e.name === 'APIConnectionTimeoutError') return new ProviderError('timeout', 'The provider did not answer in time.')
  if (e.name === 'APIConnectionError') return new ProviderError('network', 'Could not reach the provider. Check your internet connection.')
  if (typeof e.status === 'number') {
    // Never forward the server's text for auth errors: some providers echo part of the key.
    const nested = e.error?.message ?? e.error?.error?.message
    const detail = e.status === 401 || e.status === 403 ? '' : safeDetail(nested ?? e.message, secrets)
    return errorForStatus(e.status, detail)
  }
  if (e.name === 'SyntaxError' || /JSON|stream/i.test(String(e.message))) return new ProviderError('bad_response', 'The provider sent a malformed response.')
  return new ProviderError('network', 'The request to the provider failed.')
}
