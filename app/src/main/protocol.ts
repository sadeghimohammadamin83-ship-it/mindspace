import { net, protocol } from 'electron'
import { extname, join, normalize, relative, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { APP_SCHEME } from './security'

/**
 * Serves the built renderer from a custom `app://` scheme instead of file://,
 * as Electron's security guide recommends. Only files inside the renderer
 * output folder can be read; unknown paths fall back to index.html.
 */
export function registerSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ])
}

/** File to serve for a request path, or null when it is malformed or escapes the renderer folder. */
export function resolveRendererFile(rootDir: string, pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null // malformed %-escape
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null
  const target = normalize(join(rootDir, decoded))
  const rel = relative(rootDir, target)
  if (rel.startsWith('..') || isAbsolute(rel)) return null
  return extname(target) === '' ? join(rootDir, 'index.html') : target
}

export function serveRendererFrom(rootDir: string): void {
  protocol.handle(APP_SCHEME, (request) => {
    const file = resolveRendererFile(rootDir, new URL(request.url).pathname)
    if (!file) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })
}
