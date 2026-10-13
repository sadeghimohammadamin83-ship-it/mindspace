import { app, session, type WebContents } from 'electron'

export const APP_SCHEME = 'app'
export const APP_ORIGIN = `${APP_SCHEME}://mindspace`

/** Origins the renderer is allowed to be served from (dev server or app:// in production). */
export function isTrustedUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    // `origin` is the string "null" for custom schemes, so compare scheme + host explicitly.
    if (`${url.protocol}//${url.host}` === APP_ORIGIN) return true
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    return !app.isPackaged && devUrl !== undefined && url.origin === new URL(devUrl).origin
  } catch {
    return false
  }
}

/**
 * Session-wide hardening, following Electron's security checklist:
 * deny every permission except clipboard writes, block webviews,
 * block navigation and new windows.
 */
export function hardenSession(): void {
  const ses = session.defaultSession
  const allowed = new Set(['clipboard-sanitized-write'])

  ses.setPermissionRequestHandler((wc, permission, callback) => {
    callback(allowed.has(permission) && isTrustedUrl(wc.getURL()))
  })
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    return allowed.has(permission) && isTrustedUrl(requestingOrigin)
  })

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault())
    contents.on('will-navigate', (event, url) => {
      if (!isTrustedUrl(url)) event.preventDefault()
    })
    contents.on('will-redirect', (event, url) => {
      if (!isTrustedUrl(url)) event.preventDefault()
    })
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  })
}

/** Ignores IPC from anything that is not our own top-level renderer. */
export function isTrustedSender(sender: WebContents, frameUrl: string | undefined): boolean {
  return !sender.isDestroyed() && frameUrl !== undefined && isTrustedUrl(frameUrl)
}

