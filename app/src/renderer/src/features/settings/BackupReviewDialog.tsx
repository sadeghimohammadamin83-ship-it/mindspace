import { useEffect, useState } from 'react'
import { CircleAlert, CircleCheck, Lock, TriangleAlert } from 'lucide-react'
import type { BackupBridge, BackupProgress, Inspection } from '@shared/backup'
import { Badge, Button, Dialog, Field, Input, Notice } from '@/design-system/components'
import { formatBytes } from '@/features/documents/meta'
import { errorText } from '@/state/backup'
import { unwrapResult } from '@/state/documents'
import { useI18n } from '@/state/preferences'

export type ReviewSource = { type: 'pick' } | { type: 'record'; id: string }

/**
 * One flow for “Verify” and “Restore”: choose (native dialog in main) →
 * password if needed → full check → summary → (restore only) explicit
 * confirmation. Nothing here ever holds a file path; main hands back a token.
 */
export function BackupReviewDialog({
  api,
  mode,
  source,
  progress,
  onClose,
  onChanged
}: {
  api: BackupBridge
  mode: 'verify' | 'restore'
  source: ReviewSource
  progress: BackupProgress | null
  onClose: () => void
  onChanged: () => void
}) {
  const { t, fmt } = useI18n()
  const s = t.backup.review
  const [token, setToken] = useState<string | null>(null)
  const [needsPassword, setNeedsPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [info, setInfo] = useState<Inspection | null>(null)
  const [busy, setBusy] = useState<null | 'check' | 'restore'>(null)
  const [error, setError] = useState<string | null>(null)
  const [restarting, setRestarting] = useState(false)

  const check = async (tok: string, pw: string | undefined) => {
    setBusy('check')
    setError(null)
    try {
      setInfo(await unwrapResult(api.inspect({ token: tok, ...(pw ? { password: pw } : {}) })))
    } catch (err) {
      setError(errorText(err) || s.wrong)
    } finally {
      setBusy(null)
      onChanged()
    }
  }

  // Start: pick the file (or use the listed one), then check unless a password is needed first.
  useEffect(() => {
    let alive = true
    void (async () => {
      setBusy('check')
      try {
        const sel = await unwrapResult(api.select(source.type === 'record' ? { recordId: source.id } : {}))
        if (!alive) return
        if (sel.cancelled || !sel.token) return onClose()
        setToken(sel.token)
        if (sel.needsPassword) {
          setNeedsPassword(true)
          setBusy(null)
        } else {
          await check(sel.token, undefined)
        }
      } catch (err) {
        if (alive) {
          setError(errorText(err))
          setBusy(null)
        }
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const restore = async () => {
    if (!token) return
    setBusy('restore')
    setError(null)
    try {
      await unwrapResult(api.restore({ token }))
      setRestarting(true) // main restarts the app; the window closes
    } catch (err) {
      setError(errorText(err))
      setBusy(null)
      onChanged()
    }
  }

  const n = (v: number) => fmt.number(v)
  const phase = progress && (busy === 'restore' || busy === 'check') ? t.backup.phases[progress.phase as keyof typeof t.backup.phases] : undefined
  const title = mode === 'restore' ? s.restoreTitle : s.verifyTitle
  const canRestore = mode === 'restore' && info?.canRestore === true
  const excluded = info?.components.filter((c) => !c.included) ?? []

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !busy && !restarting && onClose()}
      title={title}
      width="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy === 'restore' || restarting}>
            {t.common.close}
          </Button>
          {needsPassword && !info && (
            <Button variant="primary" loading={busy === 'check'} disabled={!password || !token} onClick={() => token && void check(token, password)}>
              {s.check}
            </Button>
          )}
          {canRestore && (
            <Button variant="danger" loading={busy === 'restore'} disabled={restarting} onClick={() => void restore()}>
              {busy === 'restore' ? s.restoring : s.confirm}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        {needsPassword && !info && (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (token && password) void check(token, password)
            }}
          >
            <Notice icon={Lock} tone="info">
              {s.pickPassword}
            </Notice>
            <Field label={s.passwordLabel}>
              {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />}
            </Field>
          </form>
        )}

        {busy === 'check' && !info && (
          <p role="status" className="text-sm text-fg-muted">
            {phase ?? s.checking}
          </p>
        )}

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-soft px-3.5 py-2.5 text-sm text-fg">
            <CircleAlert size={15} className="mt-0.5 shrink-0 text-danger" aria-hidden />
            {error}
          </div>
        )}

        {info && (
          <>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-fg-subtle">{s.created}</dt>
                <dd className="text-fg">{fmt.date(info.createdAt, 'long')}</dd>
              </div>
              <div>
                <dt className="text-fg-subtle">{s.appVersion}</dt>
                <dd className="text-fg" dir="ltr">
                  {t.backup.list.version(info.appVersion, n(info.schemaVersion), n(info.formatVersion))}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-fg-subtle">{s.contents}</dt>
                <dd className="text-fg">
                  {s.counts({ notes: n(info.counts.notes), projects: n(info.counts.projects), tasks: n(info.counts.tasks), decisions: n(info.counts.decisions), tags: n(info.counts.tags), documents: n(info.counts.documents), conversations: n(info.counts.conversations) })}
                  {info.counts.semanticChunks > 0 ? ` · ${s.semantic(n(info.counts.semanticChunks))}` : ''}
                  {` · ${formatBytes(info.bytes, n)}`}
                </dd>
              </div>
            </dl>

            <ul className="flex flex-col gap-1.5 text-sm">
              <li className="flex items-center gap-2">
                {info.archiveOk ? <CircleCheck size={15} className="text-success" aria-hidden /> : <CircleAlert size={15} className="text-danger" aria-hidden />}
                <span className="font-medium text-fg">{s.archive}</span>
                <span className="text-fg-muted">{info.archiveOk ? s.archiveOk : s.failed}</span>
              </li>
              <li className="flex items-center gap-2">
                {info.databaseOk ? <CircleCheck size={15} className="text-success" aria-hidden /> : <CircleAlert size={15} className="text-danger" aria-hidden />}
                <span className="font-medium text-fg">{s.database}</span>
                <span className="text-fg-muted">{info.databaseOk ? s.databaseOk : s.failed}</span>
              </li>
              <li className="flex items-center gap-2">
                {info.compatible ? <CircleCheck size={15} className="text-success" aria-hidden /> : <CircleAlert size={15} className="text-danger" aria-hidden />}
                <span className="text-fg-muted">{info.compatible ? info.compatibilityNote : s.incompatible}</span>
              </li>
              {info.encrypted && (
                <li className="flex items-center gap-2">
                  <Badge tone="info" icon={Lock}>
                    {t.backup.list.encrypted}
                  </Badge>
                </li>
              )}
            </ul>

            {info.issues.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-sm font-medium text-fg">{s.issues}</p>
                {info.issues.map((i) => (
                  <Notice key={i.code} icon={TriangleAlert} tone="accent">
                    {i.message}
                  </Notice>
                ))}
              </div>
            )}

            {excluded.length > 0 && (
              <div className="text-sm text-fg-muted">
                <p className="font-medium text-fg">{s.notIncluded}</p>
                <ul className="mt-1 list-disc ps-5">
                  {excluded.map((c) => (
                    <li key={c.id}>{c.note}</li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-xs text-fg-subtle">{s.scopeNote}</p>

            {canRestore && (
              <div className="flex flex-col gap-2 rounded-lg border border-danger/25 bg-danger-soft px-3.5 py-3 text-sm text-fg">
                <p className="flex items-center gap-2 font-semibold">
                  <TriangleAlert size={15} className="text-danger" aria-hidden />
                  {s.restoreWarningTitle}
                </p>
                <p>{s.restoreWarning}</p>
                <p className="text-fg-muted">{s.safetyNote}</p>
                <p className="text-fg-muted">{s.keysNote}</p>
              </div>
            )}
            {mode === 'restore' && !info.canRestore && (
              <Notice icon={CircleAlert} tone="accent">
                {info.compatible ? s.failed : s.incompatible}
              </Notice>
            )}
          </>
        )}

        {busy === 'restore' && (
          <p role="status" className="text-sm text-fg-muted">
            {restarting ? s.restarting : (phase ?? s.restoring)}
          </p>
        )}
        {restarting && (
          <p role="status" className="text-sm text-fg-muted">
            {s.restarting}
          </p>
        )}
      </div>
    </Dialog>
  )
}
