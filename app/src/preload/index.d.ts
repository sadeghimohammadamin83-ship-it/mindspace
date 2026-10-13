import type { MindspaceBridge } from '../shared/ipc'

declare global {
  interface Window {
    /** Absent when the renderer runs in a plain browser (e.g. tests). */
    mindspace?: MindspaceBridge
  }
}

export {}
