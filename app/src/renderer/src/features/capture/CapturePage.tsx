import { useNavigate } from 'react-router'
import { Inbox, Keyboard } from 'lucide-react'
import { EmptyState, Kbd, Panel } from '@/design-system/components'
import { refPath } from '@/app/navigation'
import { CaptureForm } from '@/features/shared/CaptureForm'
import { Page, PageHeader } from '@/features/shared/PageHeader'
import { KindIcon } from '@/features/shared/meta'
import { useI18n } from '@/state/preferences'
import { useWorkspace } from '@/state/workspace'

export default function CapturePage() {
  const { t, fmt } = useI18n()
  const { data } = useWorkspace()
  const navigate = useNavigate()

  // Items and tasks created in this session, newest first.
  const session = [
    ...data.items.filter((i) => i.origin === 'session').map((i) => ({ ref: { type: 'item' as const, id: i.id }, kind: i.kind, title: i.title, at: i.createdAt })),
    ...data.tasks.filter((x) => x.origin === 'session').map((x) => ({ ref: { type: 'task' as const, id: x.id }, kind: 'task' as const, title: x.title, at: x.createdAt }))
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))

  const tips = [
    { keys: ['Ctrl', 'Shift', 'Space'], label: t.capture.tipOpen },
    { keys: ['Ctrl', 'Enter'], label: t.capture.tipSave },
    { keys: ['Esc'], label: t.capture.tipClose }
  ]

  return (
    <Page>
      <PageHeader title={t.capture.title} description={t.capture.description} />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-xl border border-line-subtle bg-surface p-6">
          <CaptureForm layout="page" />
        </div>
        <div className="flex flex-col gap-5">
          <Panel id="capture-session" title={t.capture.recentTitle} icon={Inbox} bodyClassName="p-1.5">
            {session.length === 0 ? (
              <EmptyState compact icon={Inbox} title={t.capture.recentEmpty} />
            ) : (
              <ul>
                {session.slice(0, 8).map((s) => (
                  <li key={s.ref.id}>
                    <button
                      type="button"
                      onClick={() => navigate(refPath(s.ref))}
                      className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-start hover:bg-hover"
                    >
                      <KindIcon kind={s.kind} size={14} />
                      <span className="min-w-0 flex-1 truncate text-sm text-fg" dir="auto">
                        {s.title}
                      </span>
                      <time dateTime={s.at} className="shrink-0 text-xs text-fg-subtle">
                        {fmt.relative(s.at)}
                      </time>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel id="capture-keys" title={t.capture.tipsTitle} icon={Keyboard} bodyClassName="px-4 py-3">
            <dl className="flex flex-col gap-2.5">
              {tips.map((tip) => (
                <div key={tip.label} className="flex items-center justify-between gap-3">
                  <dt className="text-sm text-fg-muted">{tip.label}</dt>
                  <dd className="flex shrink-0 gap-1">
                    {tip.keys.map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </Panel>
        </div>
      </div>
    </Page>
  )
}
