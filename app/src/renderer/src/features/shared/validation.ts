export { TITLE_MAX } from '@shared/limits'
import { TITLE_MAX } from '@shared/limits'

export type TitleError = 'empty' | 'long' | null

export function validateTitle(title: string): TitleError {
  const v = title.trim()
  if (!v) return 'empty'
  if (v.length > TITLE_MAX) return 'long'
  return null
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.includes('.')
  } catch {
    return false
  }
}
