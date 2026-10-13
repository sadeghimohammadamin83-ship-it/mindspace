import { useEffect, useState } from 'react'
import { Liquid } from 'liquid-gooey'
import { Lightbulb, Plus, SquareCheck, StickyNote, X, type LucideIcon } from 'lucide-react'
import { useI18n, usePreferences } from '@/state/preferences'
import { useCaptureDialog } from './CaptureDialog'

const ACTIONS: { kind: 'note' | 'idea' | 'task'; icon: LucideIcon; x: number; y: number }[] = [
  { kind: 'note', icon: StickyNote, x: 0, y: -64 },
  { kind: 'idea', icon: Lightbulb, x: -46, y: -46 },
  { kind: 'task', icon: SquareCheck, x: -64, y: 0 }
]

const BTN =
  'flex size-12 items-center justify-center rounded-full text-accent-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg'

/** Floating quick-capture button whose options pour out of it like liquid. */
export function QuickActions() {
  const { t } = useI18n()
  const { prefs } = usePreferences()
  const openCapture = useCaptureDialog()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const reduced = prefs.reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches
  // The button sits at the inline end, so the fan opens toward the inside in both directions.
  const dir = document.documentElement.dir === 'rtl' ? -1 : 1
  const transition = reduced ? { duration: 0 } : 'bouncy'
  // Reduced motion: no gooey physics, just plain round buttons.
  const Group = reduced ? 'div' : Liquid
  const groupProps = reduced ? {} : { blur: 6, contrast: 18, fill: 'var(--color-accent)', shadow: '0 4px 14px rgba(0,0,0,.35)' }
  const Item = reduced ? 'div' : Liquid.Item

  return (
    <div className="pointer-events-none fixed end-6 bottom-6 z-30" data-testid="quick-actions">
      <div className="pointer-events-auto relative size-12">
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Group {...(groupProps as any)} className="absolute inset-0">
          {ACTIONS.map((a, i) => (
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            <Item key={a.kind} {...((reduced ? { className: 'absolute inset-0', style: { transform: open ? `translate(${a.x * dir}px, ${a.y}px)` : 'none', opacity: open ? 1 : 0 } } : { x: open ? a.x * dir : 0, y: open ? a.y : 0, transition, delay: i * 40, className: 'absolute inset-0' }) as any)}>
              <button
                type="button"
                tabIndex={open ? 0 : -1}
                aria-hidden={!open}
                aria-label={t.kinds[a.kind]}
                title={t.kinds[a.kind]}
                className={`${BTN} ${reduced ? 'bg-accent' : ''}`}
                onClick={() => {
                  setOpen(false)
                  openCapture({ kind: a.kind })
                }}
              >
                <a.icon className="size-5" aria-hidden />
              </button>
            </Item>
          ))}
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <Item {...((reduced ? { className: 'absolute inset-0' } : { className: 'absolute inset-0' }) as any)}>
            <button
              type="button"
              aria-expanded={open}
              aria-label={t.capture.title}
              title={t.capture.title}
              className={`${BTN} ${reduced ? 'bg-accent' : ''}`}
              onClick={() => setOpen((o) => !o)}
            >
              {open ? <X className="size-5" aria-hidden /> : <Plus className="size-5" aria-hidden />}
            </button>
          </Item>
        </Group>
      </div>
    </div>
  )
}
