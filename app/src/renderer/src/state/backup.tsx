import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { BackupBridge, BackupProgress, BackupStatus } from '@shared/backup'
import { unwrapResult } from './documents'

/** Backup API; defaults to the preload bridge. Tests inject one backed by a temporary folder. */
export function defaultBackupApi(): BackupBridge | null {
  return typeof window !== 'undefined' ? (window.mindspace?.backup ?? null) : null
}

const BackupContext = createContext<BackupBridge | null>(null)
export const useBackupApi = () => useContext(BackupContext)

export function BackupProvider({ api, children }: { api: BackupBridge | null; children: ReactNode }) {
  return <BackupContext.Provider value={api}>{children}</BackupContext.Provider>
}

/** Plain message from a failed call, as sent by the main process. */
export const errorText = (err: unknown): string => (err instanceof Error && err.message ? err.message : '')

/** Backup status, kept fresh after every action, plus the latest progress event. */
export function useBackupStatus(apiOverride?: BackupBridge | null) {
  const ctx = useBackupApi()
  const api = apiOverride ?? ctx
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [progress, setProgress] = useState<BackupProgress | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const refresh = useCallback(async () => {
    if (!api) return
    try {
      const s = await unwrapResult(api.getStatus())
      if (alive.current) setStatus(s)
    } catch {
      /* keep the last known status */
    }
  }, [api])
  useEffect(() => {
    void refresh()
  }, [refresh])
  useEffect(() => {
    if (!api) return
    return api.onEvent((e) => alive.current && setProgress(e))
  }, [api])
  // Scheduled backups happen in the background: look again occasionally.
  useEffect(() => {
    if (!api) return
    const timer = setInterval(() => void refresh(), 60_000)
    return () => clearInterval(timer)
  }, [api, refresh])
  return { api, status, setStatus, refresh, progress, clearProgress: () => setProgress(null) }
}
