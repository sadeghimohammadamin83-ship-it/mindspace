// @vitest-environment node
/** Phase 9: regression tests for findings of the security audit. Throwaway folders only. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ net: {}, protocol: {}, app: {}, session: {} }))

import { resolveRendererFile } from '../../src/main/protocol'
import { closeDatabase, openDatabase } from '../../src/main/db/connection'
import { extractPdf } from '../../src/main/documents/extract'
import { createDocumentService } from '../../src/main/services/document-service'
import { tempDir } from './helpers/db'

describe('app:// protocol path resolution', () => {
  const root = resolve('/srv/renderer')
  it.each(['/%2e%2e/secret', '/..%2f..%2fetc/passwd', '/a/../../b.js', '/%E0%A4%A', '/a%5C..%5Cb.js', '/x%00.js'])('rejects %s', (p) => {
    expect(resolveRendererFile(root, p)).toBeNull()
  })
  it('serves files inside the folder and falls back to index.html for routes', () => {
    expect(resolveRendererFile(root, '/assets/app.js')).toBe(join(root, 'assets/app.js'))
    expect(resolveRendererFile(root, '/projects/abc')).toBe(join(root, 'index.html'))
  })
})

describe('managed document names from the database are not trusted', () => {
  let tmp: ReturnType<typeof tempDir>
  beforeEach(() => {
    tmp = tempDir()
  })
  afterEach(() => tmp.cleanup())

  it('remove and reprocess never touch a file outside the documents folder', async () => {
    const docsDir = join(tmp.dir, 'documents')
    mkdirSync(docsDir)
    const victim = join(tmp.dir, 'victim.txt')
    writeFileSync(victim, 'precious')
    const db = openDatabase(tmp.file)
    const svc = createDocumentService({ db, dir: docsDir, selectFiles: async () => null, extractPdf: async (p) => extractPdf(new Uint8Array(readFileSync(p))) })
    db.prepare(
      "INSERT INTO documents (id,title,file_name,format,mime_type,stored_name,content_hash,size_bytes,status,imported_at,updated_at) VALUES ('d1','t','t.txt','txt','text/plain','../victim.txt',?,1,'indexed','x','x')"
    ).run('a'.repeat(64))
    await svc.remove('d1').catch(() => undefined)
    await svc.reprocess('d1').catch(() => undefined)
    await svc.idle()
    expect(existsSync(victim)).toBe(true)
    expect(readFileSync(victim, 'utf8')).toBe('precious')
    expect(db.prepare("SELECT COUNT(*) FROM document_pages WHERE document_id = 'd1'").pluck().get()).toBe(0)
    closeDatabase(db)
  })
})
