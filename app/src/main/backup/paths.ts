/**
 * Archive entry names are untrusted input. Only three shapes are ever
 * accepted, so a name can never leave the staging folder: the manifest, the
 * database snapshot, and `data/documents/<managed document name>`.
 */
export const MANIFEST_NAME = 'manifest.json'
export const DB_ENTRY = 'data/database/mindspace.sqlite3'
export const DOC_PREFIX = 'data/documents/'
/** Same shape the document service uses for managed copies. */
export const STORED_NAME = /^doc-[a-f0-9-]{36}\.(pdf|txt|md)$/

export function isAllowedEntryName(name: string): boolean {
  if (name === MANIFEST_NAME || name === DB_ENTRY) return true
  if (!name.startsWith(DOC_PREFIX)) return false
  return STORED_NAME.test(name.slice(DOC_PREFIX.length))
}

/** True for names that look like traversal or absolute paths; used to report a clearer error. */
export function looksUnsafe(name: string): boolean {
  return /(^|[\\/])\.\.?([\\/]|$)/.test(name) || /^[\\/]/.test(name) || /^[a-zA-Z]:/.test(name) || name.includes('\0') || name.includes('\\')
}
