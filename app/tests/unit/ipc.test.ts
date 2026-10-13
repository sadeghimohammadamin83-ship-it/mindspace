// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { IpcChannel } from '@shared/ipc'
import { openDatabase } from '../../src/main/db/connection'
import { dataHandlers, toResult } from '../../src/main/ipc/data-handlers'
import { documentHandlers } from '../../src/main/ipc/document-handlers'
import { semanticHandlers } from '../../src/main/ipc/semantic-handlers'
import { aiHandlers } from '../../src/main/ipc/ai-handlers'
import { backupHandlers } from '../../src/main/ipc/backup-handlers'
import { createWorkspaceService, DataError } from '../../src/main/services/workspace-service'

const svc = createWorkspaceService(openDatabase(':memory:'))
const handlers = dataHandlers(() => svc)

describe('IPC boundary', () => {
  it('handles exactly the allowlisted data channels', () => {
    // aiEvent and backupEvent are one-way main → renderer push channels, not handlers.
    const dataChannels = Object.values(IpcChannel).filter((c) => c !== IpcChannel.getAppInfo && c !== IpcChannel.aiEvent && c !== IpcChannel.backupEvent)
    // Phase 4: document/search channels are registered by document-handlers.
    const docHandlers = documentHandlers(() => { throw new Error('unused') })
    // Phase 5: retrieval channels are registered by semantic-handlers.
    const semHandlers = semanticHandlers(() => { throw new Error('unused') })
    // Phase 6: AI channels are registered by ai-handlers.
    const aiH = aiHandlers(() => { throw new Error('unused') }, () => undefined)
    // Phase 8: backup channels are registered by backup-handlers.
    const backupH = backupHandlers(() => { throw new Error('unused') })
    expect([...Object.keys(handlers), ...Object.keys(docHandlers), ...Object.keys(semHandlers), ...Object.keys(aiH), ...Object.keys(backupH)].sort()).toEqual([...dataChannels].sort())
  })

  it('exposes no channel or method that accepts SQL, paths or arbitrary channels', () => {
    const names = [...Object.keys(IpcChannel), ...Object.values(IpcChannel)].join(' ').toLowerCase()
    expect(names).not.toMatch(/sql|exec|query|raw|file|path|invoke|send/)
    const preload = readFileSync(resolve(__dirname, '../../src/preload/index.ts'), 'utf8')
    expect(preload).not.toMatch(/exposeInMainWorld\([^)]*ipcRenderer\b\s*\)/)
    expect(preload).toMatch(/exposeInMainWorld\('mindspace', bridge\)/)
    // Every invoke goes through a constant from IpcChannel.
    expect(preload.match(/call\(C\.\w+/g)).toHaveLength(Object.keys(IpcChannel).length - 3)
    // The only other use of a channel constant is the push subscription, and it forwards the payload only.
    expect(preload).toMatch(/ipcRenderer\.on\(C\.aiEvent, handler\)/)
    expect(preload).toMatch(/ipcRenderer\.on\(C\.backupEvent, handler\)/)
    expect(preload).toMatch(/listener\(payload\)/)
  })

  it('returns validation errors as data, not exceptions', () => {
    const r = toResult(() => handlers[IpcChannel.createTask]!({ title: '', notes: '', status: 'todo', priority: 'x', dueDate: null, projectId: null }))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe('validation')
      expect(Object.keys(r.error.fields ?? {})).toEqual(expect.arrayContaining(['title', 'priority']))
    }
    expect(toResult(() => handlers[IpcChannel.createTask]!('not an object')).ok).toBe(false)
    expect(toResult(() => handlers[IpcChannel.deleteTask]!({ id: 1 })).ok).toBe(false)
  })

  it('hides internal error details from the renderer', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = toResult(() => {
      throw new Error('SQLITE_CORRUPT at C:\\Users\\me\\secret')
    })
    expect(r).toEqual({ ok: false, error: { code: 'internal', message: 'The database operation failed' } })
    spy.mockRestore()
    expect(toResult(() => {
      throw new DataError('unavailable', 'Database is not open')
    })).toEqual({ ok: false, error: { code: 'unavailable', message: 'Database is not open' } })
  })
})

describe('trusted origins', () => {
  it('accepts the app:// renderer and rejects everything else', async () => {
    vi.doMock('electron', () => ({ app: { isPackaged: true }, session: {} }))
    const { isTrustedUrl } = await import('../../src/main/security')
    expect(isTrustedUrl('app://mindspace/index.html#/tasks')).toBe(true)
    expect(isTrustedUrl('app://evil/index.html')).toBe(false)
    expect(isTrustedUrl('https://mindspace/index.html')).toBe(false)
    expect(isTrustedUrl('file:///C:/index.html')).toBe(false)
    expect(isTrustedUrl('not a url')).toBe(false)
    vi.doUnmock('electron')
  })
})
