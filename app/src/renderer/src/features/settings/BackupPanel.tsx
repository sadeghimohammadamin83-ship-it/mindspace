import { useId, useState } from 'react'
import { Archive, CircleAlert, CircleCheck, Lock, LockOpen, RotateCcw, ShieldCheck, TriangleAlert } from 'lucide-react'
import { RETENTION_MAX, type BackupBridge, type BackupConfig, type BackupRecord, type BackupStatus } from '@shared/backup'
import { BACKUP_PASSWORD_MIN } from '@shared/backup'
import { Badge, Button, Dialog, Field, Input, Notice, Panel, Select, Switch } from '@/design-system/components'
import { formatBytes } from '@/features/documents/meta'
import { errorText, useBackupStatus } from '@/state/backup'
import { unwrapResult } from '@/state/documents'
import { useI18n } from '@/state/preferences'
import { BackupReviewDialog, type ReviewSource } from './BackupReviewDialog'

type Review = { mode: 'verify' | 'restore'; source: ReviewSource } | null
type Tone = 'success' | 'warning' | 'danger' | 'neutral'
const verifyTone = (v: BackupRecord['verification']): Tone => (v === 'verified' ? 'success' : v === 'verified_with_warnings' ? 'warning' : v === 'failed' ? 'danger' : 'neutral')

function CreateDialog({ onCancel, onCreate, busy }: { onCancel: () => void; onCreate: (password: string | undefined) => void; busy: boolean }) {
  const { t, fmt } = useI18n()
  const s = t.backup.createDialog
  const [encrypt, setEncrypt] = useState(false)
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const id = useId()
  const short = encrypt && pw.length > 0 && pw.length < BACKUP_PASSWORD_MIN
  const mismatch = encrypt && pw2.length > 0 && pw !== pw2
  const ready = !encrypt || (pw.length >= BACKUP_PASSWORD_MIN && pw === pw2)
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !busy && onCancel()}
      title={s.title}
      description={s.description}
      width="md"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {t.common.cancel}
          </Button>
          <Button variant="primary" icon={Archive} loading={busy} disabled={!ready} onClick={() => onCreate(encrypt ? pw : undefined)}>
            {s.choose}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 pt-1">
        <div className="flex items-start justify-between gap-4">
          <div>
            <label htmlFor={id} className="text-base font-medium text-fg">
              {s.encrypt}
            </label>
            <p className="text-sm text-fg-muted">{s.encryptHint}</p>
          </div>
          <Switch id={id} checked={encrypt} onChange={setEncrypt} />
        </div>
        {encrypt ? (
          <>
            <Field label={s.password} {...(short ? { error: s.tooShort(fmt.number(BACKUP_PASSWORD_MIN)) } : {})}>
              {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />}
            </Field>
            <Field label={s.confirm} {...(mismatch ? { error: s.mismatch } : {})}>
              {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />}
            </Field>
            <Notice icon={TriangleAlert} tone="accent">
              {s.lostWarning}
            </Notice>
          </>
        ) : (
          <Notice icon={LockOpen} tone="neutral">
            {t.backup.plainWarning}
          </Notice>
        )}
      </div>
    </Dialog>
  )
}

/** Backup & recovery. Every state shown here comes from the main process; the buttons only ask. */
export function BackupPanel({ apiOverride }: { apiOverride?: BackupBridge | null }) {
  const { t, fmt } = useI18n()
  const s = t.backup
  const { api, status, setStatus, refresh, progress, clearProgress } = useBackupStatus(apiOverride)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState<null | 'create' | 'auto' | 'config'>(null)
  const [review, setReview] = useState<Review>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const keepId = useId()
  const freqId = useId()

  if (!api) {
    return (
      <Panel id="settings-backup" title={t.settings.sections.backup} icon={ShieldCheck} bodyClassName="p-5">
        <p className="text-sm text-fg-muted">{s.errors.unavailable}</p>
      </Panel>
    )
  }

  const act = async (kind: 'create' | 'auto' | 'config', fn: () => Promise<void>) => {
    setBusy(kind)
    setMessage(null)
    clearProgress()
    try {
      await fn()
    } catch (err) {
      setMessage({ tone: 'error', text: `${kind === 'config' ? '' : `${s.createFailed}. `}${errorText(err)}`.trim() })
    } finally {
      setBusy(null)
      clearProgress()
      void refresh()
    }
  }

  const reportCreated = (r: Awaited<ReturnType<typeof unwrapResult<import('@shared/backup').CreateResult>>>) => {
    if (r.cancelled) return
    const name = r.record.fileName
    if (r.record.verification === 'verified_with_warnings') setMessage({ tone: 'ok', text: s.createdWarnings })
    else setMessage({ tone: 'ok', text: r.renamed ? s.createdRenamed(name) : s.created(name) })
  }

  const create = (password: string | undefined) =>
    void act('create', async () => {
      try {
        reportCreated(await unwrapResult(api.create(password ? { password } : {})))
      } finally {
        setCreating(false)
      }
    })

  const patch = (p: Partial<BackupConfig>) =>
    void act('config', async () => {
      setStatus(await unwrapResult(api.setConfig(p)))
    })

  const st: BackupStatus | null = status
  const last = st?.lastSuccess ?? null
  const working = busy !== null || st?.busy != null
  const phase = progress ? s.phases[progress.phase as keyof typeof s.phases] : undefined
  const pct = progress?.total ? Math.round(((progress.done ?? 0) / progress.total) * 100) : null

  return (
    <Panel id="settings-backup" title={t.settings.sections.backup} icon={ShieldCheck} bodyClassName="divide-y divide-line-subtle">
      <div className="flex flex-col gap-2 px-5 py-4">
        <p className="text-base text-fg-muted">{s.intro}</p>
        <p className="text-sm text-fg-subtle">{s.excluded}</p>
        <p className="text-sm text-fg-subtle">{s.plainWarning}</p>
      </div>

      {st?.lastRestore && (
        <div className="px-5 py-4">
          <Notice icon={st.lastRestore.state === 'completed' ? CircleCheck : CircleAlert} tone={st.lastRestore.state === 'completed' ? 'info' : 'accent'} onDismiss={st.lastRestore.state === 'pending' ? undefined : () => void unwrapResult(api.dismissLastRestore()).then(setStatus, () => undefined)} dismissLabel={s.restoreState.dismiss}>
            <span className="block font-medium text-fg">{s.restoreState[st.lastRestore.state]}</span>
            <span className="text-fg-muted">{st.lastRestore.message}</span>
          </Notice>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          <p className="text-base font-medium text-fg">{s.lastSuccess}</p>
          <p className="mt-0.5 text-sm text-fg-muted" data-testid="backup-last">
            {last ? s.lastSuccessValue(fmt.relative(last.createdAt), formatBytes(last.bytes, fmt.number)) : s.never}
          </p>
          <p className="text-xs text-fg-subtle">{s.notVerified}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" icon={Archive} onClick={() => setCreating(true)} disabled={working}>
            {s.create}
          </Button>
          <Button icon={CircleCheck} onClick={() => setReview({ mode: 'verify', source: { type: 'pick' } })} disabled={working}>
            {s.verify}
          </Button>
          <Button icon={RotateCcw} onClick={() => setReview({ mode: 'restore', source: { type: 'pick' } })} disabled={working}>
            {s.restore}
          </Button>
        </div>
      </div>

      {(busy === 'create' || busy === 'auto') && (
        <div role="status" className="px-5 py-3 text-sm text-fg-muted">
          {phase ?? s.working}
          {pct !== null ? ` ${fmt.percent(pct / 100)}` : ''}
        </div>
      )}
      {message && (
        <div role={message.tone === 'error' ? 'alert' : 'status'} className="px-5 py-3">
          <Notice icon={message.tone === 'error' ? CircleAlert : CircleCheck} tone={message.tone === 'error' ? 'accent' : 'info'}>
            {message.text}
          </Notice>
        </div>
      )}

      {st && (
        <div className="flex flex-col gap-3 px-5 py-4">
          <p className="text-base font-medium text-fg">{s.auto.title}</p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-[1_1_260px]">
              <label className="text-sm font-medium text-fg">{s.auto.enable}</label>
              <p className="text-sm text-fg-muted">{s.auto.enableHint}</p>
            </div>
            <Switch checked={st.config.autoEnabled} onChange={(v) => patch({ autoEnabled: v })} aria-label={s.auto.enable} disabled={busy === 'config'} />
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex items-center gap-2">
              <label htmlFor={freqId} className="text-sm text-fg-muted">
                {s.auto.frequency}
              </label>
              <Select
                id={freqId}
                value={st.config.frequency}
                onChange={(v) => patch({ frequency: v })}
                options={[
                  { value: 'daily', label: s.auto.daily },
                  { value: 'weekly', label: s.auto.weekly }
                ]}
                className="w-32"
              />
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor={keepId} className="text-sm text-fg-muted">
                {s.auto.keep}
              </label>
              <Select
                id={keepId}
                value={String(st.config.keepAuto)}
                onChange={(v) => patch({ keepAuto: Number(v) })}
                options={[...new Set([1, 3, 5, 7, 10, 14, 30, RETENTION_MAX, st.config.keepAuto])].sort((a, b) => a - b).map((n) => ({ value: String(n), label: fmt.number(n) }))}
                className="w-24"
              />
            </div>
          </div>
          <p className="text-xs text-fg-subtle">{s.auto.keepHint}</p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-fg-muted">
                {s.auto.destination}: <span className="text-fg">{st.destination.isDefault ? s.auto.defaultFolder : st.destination.label}</span>
              </p>
              {!st.destination.available && <p className="text-sm text-danger">{s.auto.unavailable}</p>}
              <p className="text-sm text-fg-muted">
                {s.auto.next}: <span className="text-fg">{st.config.autoEnabled && st.nextAutoAt ? s.auto.nextValue(fmt.relative(st.nextAutoAt)) : s.auto.disabled}</span>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void act('config', async () => { const r = await unwrapResult(api.chooseDestination()); if (r) setStatus(r) })} disabled={working}>
                {s.auto.choose}
              </Button>
              {!st.destination.isDefault && (
                <Button size="sm" variant="ghost" onClick={() => void act('config', async () => setStatus(await unwrapResult(api.resetDestination())))} disabled={working}>
                  {s.auto.reset}
                </Button>
              )}
              <Button size="sm" onClick={() => void act('auto', async () => reportCreated(await unwrapResult(api.createAutoNow())))} loading={busy === 'auto'} disabled={working}>
                {s.auto.runNow}
              </Button>
            </div>
          </div>
          {st.lastAutoFailure && (
            <Notice icon={CircleAlert} tone="accent">
              {s.auto.lastFailure(fmt.relative(st.lastAutoFailure.at), st.lastAutoFailure.message)}
            </Notice>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2 px-5 py-4">
        <p className="text-base font-medium text-fg">{s.list.title}</p>
        {!st || st.records.length === 0 ? (
          <p className="text-sm text-fg-muted">{s.list.empty}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line-subtle rounded-lg border border-line-subtle">
            {st.records.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 px-3.5 py-3" data-testid="backup-record">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 truncate text-sm font-medium text-fg" dir="ltr">
                    {r.fileName}
                  </span>
                  <Badge tone="neutral">{s.list.kinds[r.kind]}</Badge>
                  <Badge tone={verifyTone(r.verification)}>{s.list.verification[r.verification]}</Badge>
                  <Badge tone={r.encrypted ? 'info' : 'neutral'} icon={r.encrypted ? Lock : LockOpen}>
                    {r.encrypted ? s.list.encrypted : s.list.unencrypted}
                  </Badge>
                  {!r.present && <Badge tone="danger">{s.list.missing}</Badge>}
                  {r.removable && <Badge tone="warning">{s.list.removable}</Badge>}
                </div>
                <p className="text-xs text-fg-subtle">
                  {fmt.date(r.createdAt, 'medium')} · {formatBytes(r.bytes, fmt.number)} ·{' '}
                  <span dir="ltr">{s.list.version(r.appVersion, fmt.number(r.schemaVersion), fmt.number(r.formatVersion))}</span> · {r.folder}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setReview({ mode: 'verify', source: { type: 'record', id: r.id } })} disabled={working || !r.present}>
                    {t.backup.verify.replace('…', '')}
                  </Button>
                  <Button size="sm" onClick={() => setReview({ mode: 'restore', source: { type: 'record', id: r.id } })} disabled={working || !r.present}>
                    {s.restore.replace('…', '')}
                  </Button>
                  <Button size="sm" variant="ghost" title={s.list.forgetHint} onClick={() => void unwrapResult(api.forget(r.id)).then(setStatus, () => undefined)} disabled={working}>
                    {s.list.forget}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {creating && <CreateDialog busy={busy === 'create'} onCancel={() => setCreating(false)} onCreate={create} />}
      {review && <BackupReviewDialog api={api} mode={review.mode} source={review.source} progress={progress} onClose={() => { setReview(null); void refresh() }} onChanged={() => void refresh()} />}
    </Panel>
  )
}

/** Shown instead of the app when the database cannot be opened: restoring is the way out. */
export function RecoveryRestore({ api }: { api: BackupBridge }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const { progress } = useBackupStatus(api)
  return (
    <div className="flex max-w-md flex-col items-center gap-2">
      <p className="text-sm text-fg-muted">{t.backup.recovery.text}</p>
      <Button icon={RotateCcw} onClick={() => setOpen(true)}>
        {t.backup.recovery.title}…
      </Button>
      {open && <BackupReviewDialog api={api} mode="restore" source={{ type: 'pick' }} progress={progress} onClose={() => setOpen(false)} onChanged={() => undefined} />}
    </div>
  )
}
