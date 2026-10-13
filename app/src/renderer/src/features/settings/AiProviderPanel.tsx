import { useEffect, useId, useState } from 'react'
import { Bot, CircleAlert, CircleCheck, Cloud, Cpu, KeyRound, ShieldCheck, Trash2 } from 'lucide-react'
import { isCloudProvider, PROVIDER_IDS, type CloudProviderId, type ConnectionTestResult, type ProviderId } from '@shared/ai'
import { Badge, Button, Field, Input, Notice, Panel, Switch } from '@/design-system/components'
import { ConfirmDialog } from '@/features/shared/ConfirmDialog'
import { cn } from '@/lib/cn'
import { useAiSettings } from '@/state/ai'
import { useI18n } from '@/state/preferences'

/** Provider choice, models, API keys and connection tests. Keys go to the main process and never come back. */
export function AiProviderPanel() {
  const { t, fmt } = useI18n()
  const s = t.ai.settings
  const { api, settings, refresh, apply } = useAiSettings()
  const [viewing, setViewing] = useState<ProviderId>('ollama')
  const [model, setModel] = useState('')
  const [url, setUrl] = useState('')
  const [keyDraft, setKeyDraft] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [busy, setBusy] = useState<null | 'key' | 'test' | 'save'>(null)
  const [results, setResults] = useState<Partial<Record<ProviderId, ConnectionTestResult>>>({})
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const modelListId = useId()

  // Start on the active provider once settings arrive.
  const [initial, setInitial] = useState(false)
  useEffect(() => {
    if (settings && !initial) {
      setInitial(true)
      if (settings.provider) setViewing(settings.provider)
    }
  }, [settings, initial])
  // Drafts follow the saved value of the provider being viewed.
  useEffect(() => {
    if (!settings) return
    setModel(settings[viewing].model)
    if (viewing === 'ollama') setUrl(settings.ollama.baseUrl)
    setKeyDraft('')
    setReplacing(false)
    setNotice(null)
  }, [settings, viewing])

  if (!api || !settings) {
    return (
      <Panel id="settings-ai" title={t.settings.sections.ai} icon={Bot} bodyClassName="p-5">
        <p className="text-sm text-fg-muted">{s.intro}</p>
      </Panel>
    )
  }

  const cloud = isCloudProvider(viewing)
  const name = t.ai.providers[viewing]
  const cred = cloud ? settings.credentials[viewing] : null
  const acknowledged = cloud ? settings.cloudAcknowledged[viewing] : true
  const savedModel = settings[viewing].model
  const result = results[viewing]
  const active = settings.provider === viewing

  const run = async (kind: 'key' | 'test' | 'save', fn: () => Promise<void>) => {
    setBusy(kind)
    setNotice(null)
    try {
      await fn()
    } finally {
      setBusy(null)
    }
  }
  const saveField = (patch: Parameters<typeof api.updateSettings>[0]) =>
    run('save', async () => {
      const f = await apply(api.updateSettings(patch))
      if (f) setNotice({ tone: 'error', text: f.message || s.saveFailed })
      else setResults((r) => ({ ...r, [viewing]: undefined }))
    })

  const readiness = (): string | null => {
    if (!savedModel.trim()) return s.missingModel
    if (cloud && cred?.state !== 'configured') return s.missingKey
    if (cloud && !acknowledged) return s.missingConsent
    return null
  }
  const blocked = readiness()

  const statusLine = () => {
    if (busy === 'test') return { tone: 'neutral' as const, text: s.testing }
    if (!result) return { tone: 'neutral' as const, text: s.statusUntested }
    if (result.ok) {
      const base = result.modelAvailable === true ? s.statusOkModel(result.model) : result.model ? s.statusOk : s.statusOkNoModel
      return { tone: 'success' as const, text: `${base} · ${s.latency(fmt.number(result.latencyMs))}` }
    }
    if (result.code === 'model_not_found' && result.modelAvailable === false) return { tone: 'warning' as const, text: s.statusModelMissing(result.model) }
    return { tone: 'danger' as const, text: `${s.statusFailed}: ${t.ai.errors[result.code ?? 'internal']}` }
  }
  const status = statusLine()

  return (
    <Panel id="settings-ai" title={t.settings.sections.ai} icon={Bot} bodyClassName="divide-y divide-line-subtle">
      <div className="flex flex-col gap-3 px-5 py-4">
        <p className="text-base text-fg-muted">{s.intro}</p>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-line-subtle bg-canvas/40 p-3.5">
            <p className="flex items-center gap-2 text-sm font-medium text-fg">
              <Cpu size={14} aria-hidden /> {s.localTitle}
            </p>
            <p className="mt-1 text-sm text-fg-muted">{s.localText}</p>
          </div>
          <div className="rounded-lg border border-warning/25 bg-warning-soft p-3.5">
            <p className="flex items-center gap-2 text-sm font-medium text-fg">
              <Cloud size={14} aria-hidden /> {s.cloudTitle}
            </p>
            <p className="mt-1 text-sm text-fg-muted">{s.cloudText}</p>
          </div>
        </div>
        <p role="status" className="flex items-center gap-2 text-sm text-fg-subtle">
          <ShieldCheck size={14} aria-hidden />
          {settings.provider ? s.activeNow(t.ai.providers[settings.provider]) : s.notActive}
        </p>
      </div>

      <div className="flex flex-col gap-4 px-5 py-4">
        <div role="radiogroup" aria-label={t.settings.sections.ai} className="grid gap-2 sm:grid-cols-3">
          {PROVIDER_IDS.map((p) => {
            const selected = p === viewing
            const Icon = isCloudProvider(p) ? Cloud : Cpu
            return (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setViewing(p)}
                className={cn('flex flex-col gap-1.5 rounded-lg border p-3.5 text-start transition-colors', selected ? 'border-accent-line bg-accent-soft' : 'border-line-subtle bg-canvas/40 hover:border-line')}
              >
                <span className="flex items-center gap-2 text-base font-medium text-fg">
                  <Icon size={15} className={selected ? 'text-accent-text' : 'text-fg-subtle'} aria-hidden />
                  {t.ai.providers[p]}
                  {settings.provider === p && (
                    <Badge tone="success" className="ms-auto">
                      {s.active}
                    </Badge>
                  )}
                </span>
                <span className="text-xs text-fg-subtle">{isCloudProvider(p) ? t.ai.kindCloud : t.ai.kindLocal}</span>
              </button>
            )
          })}
        </div>

        {viewing === 'ollama' && (
          <Field label={s.address} hint={`${s.addressHint} ${s.advancedNote}`}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                dir="ltr"
                value={url}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                onChange={(e) => setUrl(e.target.value)}
                onBlur={() => url.trim() !== settings.ollama.baseUrl && void saveField({ ollama: { baseUrl: url } })}
              />
            )}
          </Field>
        )}

        <Field label={s.model} hint={cloud ? s.modelHintCloud : s.modelHintOllama}>
          {({ id, describedBy }) => (
            <>
              <Input
                id={id}
                dir="ltr"
                list={modelListId}
                value={model}
                placeholder={s.modelPlaceholder}
                aria-describedby={describedBy}
                autoComplete="off"
                onChange={(e) => setModel(e.target.value)}
                onBlur={() => model.trim() !== savedModel && void saveField({ [viewing]: { model: model.trim() } })}
              />
              <datalist id={modelListId}>
                {(result?.models ?? []).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              {result && result.models.length > 1 && <p className="mt-1 text-xs text-fg-subtle">{s.modelsFound(fmt.number(result.models.length))}</p>}
            </>
          )}
        </Field>

        {cloud && cred && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-fg">{s.key}</p>
            <p className="text-xs text-fg-subtle">{s.keyHint}</p>
            {!settings.encryptionAvailable && <Notice icon={CircleAlert}>{s.encryptionMissing}</Notice>}
            {cred.state === 'unreadable' && <Notice icon={CircleAlert}>{s.keyUnreadable}</Notice>}
            {cred.state !== 'none' && !replacing ? (
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={cred.state === 'configured' ? 'success' : 'warning'} icon={KeyRound}>
                  {cred.state === 'configured' ? s.keyConfigured : s.keyNone}
                </Badge>
                {cred.updatedAt && <span className="text-xs text-fg-subtle">{s.keyUpdated(fmt.date(cred.updatedAt, 'medium'))}</span>}
                <Button size="sm" onClick={() => setReplacing(true)} disabled={!settings.encryptionAvailable}>
                  {s.replaceKey}
                </Button>
                <Button size="sm" variant="danger" icon={Trash2} onClick={() => setConfirmRemove(true)}>
                  {s.removeKey}
                </Button>
              </div>
            ) : (
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  void run('key', async () => {
                    const key = keyDraft
                    const f = await apply(api.saveKey({ provider: viewing as CloudProviderId, key }))
                    setKeyDraft('') // the key does not stay in interface state
                    if (f) setNotice({ tone: 'error', text: f.message || s.saveFailed })
                    else {
                      setReplacing(false)
                      setResults((r) => ({ ...r, [viewing]: undefined }))
                      setNotice({ tone: 'ok', text: s.keySaved })
                    }
                  })
                }}
              >
                <label htmlFor={`${modelListId}-key`} className="sr-only">
                  {s.key}
                </label>
                <Input
                  id={`${modelListId}-key`}
                  type="password"
                  dir="ltr"
                  autoComplete="off"
                  spellCheck={false}
                  className="max-w-sm flex-1"
                  value={keyDraft}
                  placeholder={s.keyPlaceholder}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  disabled={!settings.encryptionAvailable}
                />
                <Button type="submit" variant="primary" loading={busy === 'key'} disabled={!keyDraft.trim() || !settings.encryptionAvailable}>
                  {s.saveKey}
                </Button>
                {replacing && (
                  <Button
                    onClick={() => {
                      setReplacing(false)
                      setKeyDraft('')
                    }}
                  >
                    {s.cancel}
                  </Button>
                )}
              </form>
            )}
            <p className="flex items-start gap-2 text-xs text-fg-subtle">
              <ShieldCheck size={13} className="mt-0.5 shrink-0" aria-hidden />
              {s.keyStorage}
            </p>
            <label className="mt-1 flex cursor-pointer items-start gap-3 rounded-lg border border-warning/25 bg-warning-soft p-3.5">
              <Switch
                checked={acknowledged}
                onChange={(v) => void saveField({ cloudAcknowledged: { [viewing]: v } })}
                aria-label={s.consent(name)}
              />
              <span className="text-sm text-fg">{s.consent(name)}</span>
            </label>
          </div>
        )}

        {notice && (
          <Notice icon={notice.tone === 'ok' ? CircleCheck : CircleAlert}>{notice.text}</Notice>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button loading={busy === 'test'} disabled={busy !== null || (cloud && cred?.state !== 'configured')} onClick={() => run('test', async () => {
            const r = await api.testConnection(viewing)
            if (r.ok) setResults((x) => ({ ...x, [viewing]: r.value }))
            else setNotice({ tone: 'error', text: r.error.message })
          })}>
            {s.test}
          </Button>
          <span role="status" className={cn('flex items-center gap-1.5 text-sm', status.tone === 'success' ? 'text-success' : status.tone === 'danger' ? 'text-danger' : status.tone === 'warning' ? 'text-warning' : 'text-fg-subtle')}>
            {status.tone === 'success' ? <CircleCheck size={14} aria-hidden /> : status.tone === 'neutral' ? null : <CircleAlert size={14} aria-hidden />}
            {status.text}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line-subtle pt-4">
          {active ? (
            <Button onClick={() => void run('save', async () => void (await apply(api.updateSettings({ provider: null }))))} disabled={busy !== null}>
              {s.stopUsing}
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={busy !== null || blocked !== null}
              onClick={() =>
                void run('save', async () => {
                  const f = await apply(api.updateSettings({ provider: viewing }))
                  if (f) setNotice({ tone: 'error', text: f.code === 'consent_required' ? t.ai.errors.consent_required : f.message || s.saveFailed })
                })
              }
            >
              {s.useThis}
            </Button>
          )}
          {!active && blocked && <span className="text-xs text-fg-subtle">{blocked}</span>}
        </div>
      </div>

      <ConfirmDialog
        open={confirmRemove}
        title={s.removeKey}
        description={name}
        confirmLabel={s.removeKey}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => {
          setConfirmRemove(false)
          void run('key', async () => {
            const f = await apply(api.removeKey(viewing as CloudProviderId))
            if (!f) {
              setResults((r) => ({ ...r, [viewing]: undefined }))
              setNotice({ tone: 'ok', text: s.keyRemoved })
            }
            await refresh()
          })
        }}
      />
    </Panel>
  )
}
