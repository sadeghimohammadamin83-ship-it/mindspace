import { useEffect, useId, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { Archive, Bot, Download, HardDrive, Info, Keyboard, Network, Palette, RefreshCw, RotateCcw, ShieldCheck, SlidersHorizontal, Sparkles } from 'lucide-react'
import type { AppInfo } from '@shared/ipc'
import { ITEM_KINDS } from '@shared/domain'
import { Badge, Button, Kbd, Notice, Panel, Segmented, Select, Switch } from '@/design-system/components'
import { LogoMark } from '@/app/Logo'
import { Page, PageHeader } from '@/features/shared/PageHeader'
import type { CaptureKind } from '@/features/shared/CaptureForm'
import { useI18n, usePreferences } from '@/state/preferences'
import { useRetrievalApi, useSemanticStatus } from '@/state/retrieval'
import { formatBytes } from '@/features/documents/meta'
import { AiProviderPanel } from './AiProviderPanel'
import { BackupPanel } from './BackupPanel'

type SectionId = 'appearance' | 'general' | 'semantic' | 'ai' | 'backup' | 'data' | 'shortcuts' | 'about'
const SECTIONS: Array<{ id: SectionId; icon: typeof Palette }> = [
  { id: 'appearance', icon: Palette },
  { id: 'general', icon: SlidersHorizontal },
  { id: 'semantic', icon: Sparkles },
  { id: 'ai', icon: Bot },
  { id: 'backup', icon: Archive },
  { id: 'data', icon: ShieldCheck },
  { id: 'shortcuts', icon: Keyboard },
  { id: 'about', icon: Info }
]

/** One setting: label and hint on the start side, control on the end side. */
function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: (ids: { id: string; hintId?: string }) => ReactNode }) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 px-5 py-4">
      <div className="min-w-0 flex-[1_1_240px]">
        <label htmlFor={id} className="text-base font-medium text-fg">
          {label}
        </label>
        {hint && (
          <p id={hintId} className="mt-0.5 text-sm text-fg-muted">
            {hint}
          </p>
        )}
      </div>
      <div className="shrink-0">{children({ id, ...(hintId ? { hintId } : {}) })}</div>
    </div>
  )
}

function useAppInfo(): AppInfo | null | 'browser' {
  const [info, setInfo] = useState<AppInfo | null | 'browser'>(null)
  useEffect(() => {
    if (!window.mindspace) {
      setInfo('browser')
      return
    }
    let alive = true
    window.mindspace
      .getAppInfo()
      .then((i) => alive && setInfo(i))
      .catch(() => alive && setInfo('browser'))
    return () => {
      alive = false
    }
  }, [])
  return info
}

/** Local embedding model setup and index state (Phase 5). Download only on explicit click. */
function SemanticPanel() {
  const { t, fmt } = useI18n()
  const api = useRetrievalApi()
  const { status, setup, rebuild } = useSemanticStatus()
  const [busy, setBusy] = useState(false)
  const s = t.settings.semantic
  const m = status?.model
  const ix = status?.index
  const size = m ? formatBytes(m.bytesTotal, fmt.number) : '…'
  const run = (f: () => Promise<void>) => {
    setBusy(true)
    void f().finally(() => setBusy(false))
  }
  const tone = !m ? 'neutral' : m.state === 'loaded' ? 'success' : m.state === 'error' ? 'danger' : m.state === 'missing' ? 'neutral' : 'info'
  return (
    <Panel id="settings-semantic" title={s.title} icon={Sparkles} bodyClassName="divide-y divide-line-subtle">
      <div className="flex flex-col gap-2 px-5 py-4">
        <p className="text-sm text-fg-muted">{s.intro}</p>
        <p className="flex items-start gap-2 text-sm text-fg-subtle">
          <ShieldCheck size={14} className="mt-0.5 shrink-0" aria-hidden />
          {s.privacy.replace('{size}', size)}
        </p>
      </div>
      <Row
        label={s.model}
        hint={
          m ? (
            <>
              <span dir="ltr">{m.displayName}</span> · {s.modelDetails(m.license, fmt.number(m.dimensions))}
              {m.error && <span className="mt-1 block text-danger">{s.errors[m.error]}</span>}
              {m.state === 'downloading' && m.bytesTotal > 0 && (
                <span className="mt-2 block">
                  <span className="block h-1.5 w-full overflow-hidden rounded-full bg-raised" role="progressbar" aria-valuemin={0} aria-valuemax={m.bytesTotal} aria-valuenow={m.bytesDone}>
                    <span className="block h-full bg-accent transition-[width]" style={{ width: `${Math.min(100, (m.bytesDone / m.bytesTotal) * 100)}%` }} />
                  </span>
                  <span className="mt-1 block text-xs">{s.progress(formatBytes(m.bytesDone, fmt.number), size)}</span>
                </span>
              )}
            </>
          ) : undefined
        }
      >
        {() => (
          <div className="flex items-center gap-2">
            {m && <Badge tone={tone}>{s.states[m.state]}</Badge>}
            {m && (m.state === 'missing' || m.state === 'error') && (
              <Button icon={Download} loading={busy} disabled={!api || busy} onClick={() => run(setup)}>
                {m.state === 'error' ? s.retry : s.setup}
              </Button>
            )}
          </div>
        )}
      </Row>
      <Row
        label={s.index}
        hint={
          ix ? (
            <>
              {s.indexCounts(fmt.number(ix.sources), fmt.number(ix.chunks))} ·{' '}
              {ix.state === 'indexing' ? s.indexing(fmt.number(ix.pending)) : ix.state === 'paused' ? s.indexPaused : s.indexIdle}
              {ix.failed > 0 && <span className="text-warning"> · {s.indexFailed(fmt.number(ix.failed))}</span>}
              <span className="mt-0.5 block text-xs text-fg-subtle">{s.rebuildHint}</span>
            </>
          ) : undefined
        }
      >
        {() => (
          <Button icon={RefreshCw} disabled={!api || busy || m?.state !== 'loaded' || ix?.state === 'indexing'} onClick={() => run(rebuild)}>
            {s.rebuild}
          </Button>
        )}
      </Row>
    </Panel>
  )
}

export default function SettingsPage() {
  const { t } = useI18n()
  const { prefs, setPref } = usePreferences()
  const location = useLocation()
  const info = useAppInfo()

  useEffect(() => {
    const id = location.hash.replace('#', '')
    if (id) document.getElementById(`settings-${id}`)?.scrollIntoView({ block: 'start' })
  }, [location.hash])

  const shortcuts: Array<{ keys: string[]; label: string }> = [
    { keys: ['Ctrl', 'K'], label: t.shortcuts.search },
    { keys: ['Ctrl', 'Shift', 'Space'], label: t.shortcuts.capture },
    { keys: ['Ctrl', '1…8'], label: t.shortcuts.navigate },
    { keys: ['Ctrl', 'Enter'], label: t.shortcuts.save },
    { keys: ['Esc'], label: t.shortcuts.close },
    { keys: ['Enter'], label: t.shortcuts.send },
    { keys: ['Shift', 'Enter'], label: t.shortcuts.newline }
  ]

  const captureOptions: CaptureKind[] = [...ITEM_KINDS, 'task']

  return (
    <Page>
      <PageHeader title={t.settings.title} description={t.settings.description} />
      <div className="grid items-start gap-8 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label={t.settings.title} className="sticky top-0 hidden flex-col gap-0.5 lg:flex">
          {SECTIONS.map(({ id, icon: Icon }) => (
            <a
              key={id}
              href={`#/settings#${id}`}
              onClick={(e) => {
                e.preventDefault()
                document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
              className="flex h-8.5 items-center gap-2.5 rounded-md px-2.5 text-base text-fg-muted transition-colors hover:bg-hover hover:text-fg"
            >
              <Icon size={15} strokeWidth={1.75} aria-hidden />
              {t.settings.sections[id]}
            </a>
          ))}
        </nav>

        <div className="flex min-w-0 flex-col gap-6">
          <Notice icon={Info}>{t.settings.sessionOnly}</Notice>

          <Panel id="settings-appearance" title={t.settings.sections.appearance} icon={Palette} bodyClassName="divide-y divide-line-subtle">
            <Row label={t.settings.language} hint={t.settings.languageHint}>
              {({ id }) => (
                <Segmented
                  id={id}
                  label={t.settings.language}
                  value={prefs.lang}
                  onChange={(v) => setPref('lang', v)}
                  options={[
                    { value: 'fa', label: 'فارسی' },
                    { value: 'en', label: 'English' }
                  ]}
                />
              )}
            </Row>
            <Row label={t.settings.calendar} hint={t.settings.calendarHint}>
              {({ id }) => (
                <Segmented
                  id={id}
                  label={t.settings.calendar}
                  value={prefs.calendar}
                  onChange={(v) => setPref('calendar', v)}
                  options={[
                    { value: 'persian', label: t.settings.calendarPersian },
                    { value: 'gregory', label: t.settings.calendarGregorian }
                  ]}
                />
              )}
            </Row>
            <Row label={t.settings.theme} hint={t.settings.themeHint}>
              {({ id }) => (
                <Segmented
                  id={id}
                  label={t.settings.theme}
                  value="dark"
                  onChange={() => undefined}
                  options={[
                    { value: 'dark', label: t.settings.themeDark },
                    { value: 'light', label: t.settings.themeLight, disabled: true }
                  ]}
                />
              )}
            </Row>
            <Row label={t.settings.reduceMotion} hint={t.settings.reduceMotionHint}>
              {({ id, hintId }) => (
                <Switch id={id} checked={prefs.reduceMotion} onChange={(v) => setPref('reduceMotion', v)} {...(hintId ? { 'aria-describedby': hintId } : {})} />
              )}
            </Row>
          </Panel>

          <Panel id="settings-general" title={t.settings.sections.general} icon={SlidersHorizontal} bodyClassName="divide-y divide-line-subtle">
            <Row label={t.settings.defaultCapture} hint={t.settings.defaultCaptureHint}>
              {({ id }) => (
                <Select
                  id={id}
                  value={prefs.defaultCaptureKind}
                  onChange={(v) => setPref('defaultCaptureKind', v)}
                  options={captureOptions.map((k) => ({ value: k, label: t.kinds[k] }))}
                  className="w-44"
                />
              )}
            </Row>
            <Row label={t.settings.sidebarCounts} hint={t.settings.sidebarCountsHint}>
              {({ id, hintId }) => (
                <Switch id={id} checked={prefs.showSidebarCounts} onChange={(v) => setPref('showSidebarCounts', v)} {...(hintId ? { 'aria-describedby': hintId } : {})} />
              )}
            </Row>
          </Panel>

          <SemanticPanel />

          <AiProviderPanel />

          <BackupPanel />

          <Panel id="settings-data" title={t.settings.sections.data} icon={ShieldCheck} bodyClassName="divide-y divide-line-subtle">
            <div className="flex items-start gap-3 px-5 py-4">
              <HardDrive size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-fg-subtle" aria-hidden />
              <div>
                <p className="text-base font-medium text-fg">{t.settings.storage}</p>
                <p className="mt-0.5 text-sm text-fg-muted">{t.settings.storageValue}</p>
                <p className="mt-1 text-sm text-fg-subtle">{t.settings.storagePlanned}</p>
              </div>
            </div>
            <div className="flex items-start gap-3 px-5 py-4">
              <Network size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-fg-subtle" aria-hidden />
              <div>
                <p className="text-base font-medium text-fg">{t.settings.network}</p>
                <p className="mt-0.5 text-sm text-fg-muted">{t.settings.networkValue}</p>
              </div>
            </div>
            <Row label={t.settings.reset} hint={t.settings.resetHint}>
              {({ id }) => (
                <Button id={id} variant="danger" icon={RotateCcw} disabled>
                  {t.settings.reset}
                </Button>
              )}
            </Row>
          </Panel>

          <Panel id="settings-shortcuts" title={t.settings.sections.shortcuts} icon={Keyboard} bodyClassName="px-5 py-4">
            <p className="mb-3 text-sm text-fg-muted">{t.settings.shortcutsIntro}</p>
            <table className="w-full text-base">
              <tbody className="divide-y divide-line-subtle">
                {shortcuts.map((s) => (
                  <tr key={s.label}>
                    <td className="py-2.5 text-fg">{s.label}</td>
                    <td className="py-2.5 text-end">
                      <span className="inline-flex gap-1" dir="ltr">
                        {s.keys.map((k) => (
                          <Kbd key={k}>{k}</Kbd>
                        ))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel id="settings-about" title={t.settings.sections.about} icon={Info} bodyClassName="flex flex-col gap-4 p-5">
            <div className="flex items-center gap-3">
              <LogoMark size={36} />
              <div>
                <p className="text-md font-semibold tracking-[0.18em] text-fg" dir="ltr">
                  MINDSPACE
                </p>
                <p className="text-sm text-fg-muted">{t.settings.aboutPrivacy}</p>
              </div>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-fg-subtle">{t.settings.aboutPhase}</dt>
              <dd className="text-fg">{t.settings.aboutPhaseValue}</dd>
              <dt className="text-fg-subtle">{t.settings.aboutVersion}</dt>
              <dd className="text-fg" dir="ltr">
                {info && info !== 'browser' ? info.version : '0.1.0'}
              </dd>
              <dt className="text-fg-subtle">{t.settings.aboutRuntime}</dt>
              <dd className="text-fg-muted" dir={info && info !== 'browser' ? 'ltr' : undefined}>
                {info === null
                  ? t.common.loading
                  : info === 'browser'
                    ? t.settings.aboutBrowser
                    : `Electron ${info.electron} · Chromium ${info.chrome} · Node ${info.node} · ${info.platform}`}
              </dd>
            </dl>
            <p className="flex items-start gap-2 text-sm text-fg-subtle">
              <Archive size={14} className="mt-0.5 shrink-0" aria-hidden />
              {t.settings.aboutCredits}
            </p>
          </Panel>
        </div>
      </div>

    </Page>
  )
}
