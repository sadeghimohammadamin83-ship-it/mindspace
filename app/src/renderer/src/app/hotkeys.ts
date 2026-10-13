import { useEffect, useRef } from 'react'

export interface Hotkey {
  key: string
  ctrl?: boolean
  shift?: boolean
  /** Fire even while focus is in a text field. */
  allowInFields?: boolean
  handler: (e: KeyboardEvent) => void
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/** Window-level keyboard shortcuts. Uses `code`, so it works on Persian layouts too. */
export function useHotkeys(hotkeys: Hotkey[]): void {
  const ref = useRef(hotkeys)
  ref.current = hotkeys
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      for (const h of ref.current) {
        const ctrl = e.ctrlKey || e.metaKey
        if (Boolean(h.ctrl) !== ctrl || Boolean(h.shift) !== e.shiftKey || e.altKey) continue
        if (e.code !== h.key) continue
        if (!h.allowInFields && isTypingTarget(e.target)) continue
        e.preventDefault()
        h.handler(e)
        return
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
