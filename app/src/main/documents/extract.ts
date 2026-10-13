/**
 * Text extraction. Pure functions over bytes, so they can run in a worker
 * thread (production) or directly (tests). Nothing here writes files or
 * executes document content; pdf.js runs with eval disabled and no fonts,
 * scripts or network.
 */
import { DOCUMENT_LIMITS, type DocumentError } from '@shared/documents'

export class ExtractError extends Error {
  constructor(readonly code: DocumentError) {
    super(code)
    this.name = 'ExtractError'
  }
}

export interface Extracted {
  /** pages[0] is page 1. TXT/Markdown produce one entry. */
  pages: string[]
  /** PDFs only. */
  pageCount: number | null
}

/** Strict UTF-8 (optional BOM). Rejects other encodings instead of guessing. */
export function decodeUtf8(bytes: Uint8Array): string {
  if (bytes.includes(0)) throw new ExtractError('invalid_encoding')
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)
  } catch {
    throw new ExtractError('invalid_encoding')
  }
}

/** TXT and Markdown are stored as written (line endings unified); Markdown is never rendered as HTML. */
export function extractText(bytes: Uint8Array): Extracted {
  const text = decodeUtf8(bytes).replace(/\r\n?/g, '\n')
  if (text.length > DOCUMENT_LIMITS.extractedChars) throw new ExtractError('too_large')
  return { pages: [text], pageCount: null }
}

/** Joins pdf.js text items, keeping line breaks the PDF marks. */
function pageText(items: unknown[]): string {
  let out = ''
  for (const it of items as { str?: string; hasEOL?: boolean }[]) {
    if (typeof it.str !== 'string') continue
    out += it.str
    if (it.hasEOL) out += '\n'
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

export async function extractPdf(bytes: Uint8Array, onProgress?: (done: number, total: number) => void): Promise<Extracted> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  let doc: Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>
  const task = pdfjs.getDocument({
      data: bytes,
      disableFontFace: true,
      useSystemFonts: false,
      enableXfa: false,
      stopAtErrors: false,
      verbosity: 0
    })
  try {
    doc = await task.promise
  } catch (err) {
    await task.destroy().catch(() => undefined)
    const name = (err as { name?: string }).name
    throw new ExtractError(name === 'PasswordException' ? 'encrypted' : 'corrupt')
  }
  try {
    if (doc.numPages > DOCUMENT_LIMITS.pdfPages) throw new ExtractError('too_many_pages')
    const pages: string[] = []
    let chars = 0
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      const text = pageText(content.items)
      chars += text.length
      if (chars > DOCUMENT_LIMITS.extractedChars) throw new ExtractError('too_large')
      pages.push(text)
      page.cleanup()
      onProgress?.(n, doc.numPages)
    }
    return { pages, pageCount: doc.numPages }
  } catch (err) {
    if (err instanceof ExtractError) throw err
    throw new ExtractError('corrupt')
  } finally {
    await task.destroy()
  }
}
