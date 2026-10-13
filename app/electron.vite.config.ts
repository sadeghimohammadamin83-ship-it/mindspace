import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

/**
 * The production Content-Security-Policy lives in src/renderer/index.html.
 * The Vite dev server needs inline scripts (React Fast Refresh preamble) and a
 * websocket for HMR, so in `serve` mode only, the policy is relaxed.
 */
function devCsp(): Plugin {
  return {
    name: 'mindspace-dev-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html
        .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
        .replace("connect-src 'none'", "connect-src 'self' ws://localhost:*")
        .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
    }
  }
}

const shared = resolve(__dirname, 'src/shared')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        '@shared': shared
      }
    },
    plugins: [react(), tailwindcss(), devCsp()],
    build: { minify: true }
  }
})
