import { createContext, useContext, type ReactNode } from 'react'
import type { DocumentsBridge } from '@shared/documents'
import type { DataResult } from '@shared/ipc'

/** Document/search API; defaults to the preload bridge. Tests inject one backed by a temporary database. */
const DocumentsContext = createContext<DocumentsBridge | null>(null)

export function defaultDocumentsApi(): DocumentsBridge | null {
  return typeof window !== 'undefined' ? (window.mindspace?.documents ?? null) : null
}

export function DocumentsProvider({ api, children }: { api: DocumentsBridge | null; children: ReactNode }) {
  return <DocumentsContext.Provider value={api}>{children}</DocumentsContext.Provider>
}

export const useDocumentsApi = () => useContext(DocumentsContext)

export async function unwrapResult<T>(p: Promise<DataResult<T>>): Promise<T> {
  const r = await p
  if (!r.ok) throw Object.assign(new Error(r.error.message), { code: r.error.code })
  return r.value
}
