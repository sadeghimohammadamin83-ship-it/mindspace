import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowRightLeft, Check, ChevronDown, Link2, Pencil, RotateCcw, Trash2, X } from 'lucide-react'
import {
  DECISION_TRANSITIONS,
  type Decision,
  type DecisionStatus,
  type Id
} from '@shared/domain'
import {
  Button,
  Dialog,
  Drawer,
  EmptyState,
  Field,
  Menu,
  MenuItem,
  Select,
  useToast
} from '@/design-system/components'
import { OriginMark } from '@/features/shared/meta'
import { ConfirmDialog } from '@/features/shared/ConfirmDialog'
import { useSaveError } from '@/features/shared/useSaveError'
import { useI18n } from '@/state/preferences'
import { useWorkspace } from '@/state/workspace'
import { findProject } from '@/state/selectors'
import { findDecision, relatedForDecision, type RelatedEntry } from '@/state/memory'
import { DecisionEditorDialog, type DecisionEditorState } from './DecisionEditorDialog'
import { DecisionStatusBadge } from './DecisionStatus'
import { LinkPickerDialog } from './LinkPickerDialog'
import { RelatedContent, RelatedList } from './RelatedContent'
import { TagEditor } from './TagEditor'

function TextSection({ title, text }: { title: string; text: string }) {
  if (!text.trim()) return null
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      <p dir="auto" className="text-md leading-relaxed whitespace-pre-wrap text-fg">
        {text}
      </p>
    </section>
  )
}

/** Would choosing `candidate` as replacement lead back to `decision`? Mirrors the server's loop check. */
function wouldLoop(decisions: Decision[], decision: Decision, candidate: Decision): boolean {
  for (let cur: Decision | undefined = candidate, hops = 0; cur?.supersededById && hops < 1000; hops++) {
    if (cur.supersededById === decision.id) return true
    cur = decisions.find((d) => d.id === cur?.supersededById)
  }
  return false
}

function SupersedeDialog({ decision, open, onClose }: { decision: Decision; open: boolean; onClose: () => void }) {
  const { t } = useI18n()
  const { data, commands } = useWorkspace()
  const toast = useToast()
  const saveError = useSaveError()
  const candidates = useMemo(
    () =>
      data.decisions.filter(
        (d) => d.id !== decision.id && d.status !== 'rejected' && !wouldLoop(data.decisions, decision, d)
      ),
    [data.decisions, decision]
  )
  const [choice, setChoice] = useState<Id | ''>('')
  const [saving, setSaving] = useState(false)
  const value = choice && candidates.some((c) => c.id === choice) ? choice : (candidates[0]?.id ?? '')

  const confirm = async () => {
    if (!value || saving) return
    setSaving(true)
    try {
      await commands.setDecisionStatus({ id: decision.id, status: 'superseded', supersededById: value })
      toast({ title: t.memory.statusChanged(t.memory.status.superseded), description: decision.title, tone: 'success' })
      onClose()
    } catch (err) {
      saveError(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !saving && onClose()}
      title={t.memory.supersedeTitle}
      description={t.memory.supersedeDescription}
      width="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {t.common.cancel}
          </Button>
          <Button variant="primary" onClick={() => void confirm()} loading={saving} disabled={!value}>
            {t.memory.supersedeConfirm}
          </Button>
        </>
      }
    >
      {candidates.length === 0 ? (
        <p className="text-sm text-fg-muted">{t.memory.supersedeNone}</p>
      ) : (
        <Field label={t.memory.supersedeLabel}>
          {({ id }) => (
            <Select
              id={id}
              value={value}
              onChange={setChoice}
              options={candidates.map((c) => ({ value: c.id, label: `${c.title} · ${t.memory.status[c.status]}` }))}
            />
          )}
        </Field>
      )}
    </Dialog>
  )
}

/** Side drawer with the full decision record, its relationships and its lifecycle actions. */
export function DecisionDetail({ decisionId, onClose }: { decisionId: string | null; onClose: () => void }) {
  const { t, fmt } = useI18n()
  const { data, commands } = useWorkspace()
  const toast = useToast()
  const saveError = useSaveError()
  const decision = findDecision(data, decisionId)
  const [editor, setEditor] = useState<DecisionEditorState>({ open: false })
  const [picker, setPicker] = useState<'note' | 'task' | null>(null)
  const [supersede, setSupersede] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)

  const project = decision ? findProject(data, decision.projectId) : undefined

  const changeStatus = async (status: DecisionStatus) => {
    if (!decision || busy) return
    if (status === 'superseded') return setSupersede(true)
    setBusy(true)
    try {
      await commands.setDecisionStatus({ id: decision.id, status })
      toast({ title: t.memory.statusChanged(t.memory.status[status]), description: decision.title, tone: 'success' })
    } catch (err) {
      saveError(err)
    } finally {
      setBusy(false)
    }
  }

  const unlink = async (entry: RelatedEntry) => {
    if (!decision || (entry.type !== 'item' && entry.type !== 'task')) return
    try {
      await commands.unlinkDecision({ decisionId: decision.id, targetType: entry.type, targetId: entry.record.id })
      toast({ title: t.memory.linkRemoved, tone: 'info' })
    } catch (err) {
      saveError(err)
    }
  }

  const remove = async () => {
    if (!decision || busy) return
    setBusy(true)
    try {
      await commands.deleteDecision(decision.id)
      toast({ title: t.memory.decisionDeleted, description: decision.title, tone: 'info' })
      setConfirmDelete(false)
      onClose()
    } catch (err) {
      saveError(err)
    } finally {
      setBusy(false)
    }
  }

  const groups = decision ? relatedForDecision(data, decision) : []
  const entriesOf = (key: string) => groups.find((g) => g.key === key)?.entries ?? []
  const noteOptions = decision
    ? data.items
        .filter((i) => !decision.noteIds.includes(i.id))
        .map((i) => ({ id: i.id, title: i.title, subtitle: t.kinds[i.kind] }))
    : []
  const taskOptions = decision
    ? data.tasks
        .filter((x) => !decision.taskIds.includes(x.id))
        .map((x) => ({ id: x.id, title: x.title, subtitle: t.taskStatus[x.status] }))
    : []

  const transitions = decision ? DECISION_TRANSITIONS[decision.status] : []
  const statusAction: Record<DecisionStatus, { label: string; icon: typeof Check }> = {
    accepted: { label: decision?.status === 'superseded' ? t.memory.actionRestore : t.memory.actionAccept, icon: Check },
    rejected: { label: t.memory.actionReject, icon: X },
    proposed: { label: t.memory.actionReopen, icon: RotateCcw },
    superseded: { label: t.memory.actionSupersede, icon: ArrowRightLeft }
  }

  let body: ReactNode = <EmptyState icon={Link2} title={t.memory.decisionNotFound} />
  if (decision) {
    const replacementMissing = decision.status === 'superseded' && !decision.supersededById
    body = (
      <div className="flex flex-col gap-6">
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-2.5 text-sm">
          <dt className="text-fg-subtle">{t.common.status}</dt>
          <dd className="flex flex-wrap items-center gap-2">
            <DecisionStatusBadge status={decision.status} />
            <span className="text-fg-muted">{t.memory.statusHelp[decision.status]}</span>
          </dd>
          {decision.decidedOn && (
            <>
              <dt className="text-fg-subtle">{t.memory.decidedOn}</dt>
              <dd className="text-fg-muted">
                <time dateTime={decision.decidedOn}>{fmt.date(decision.decidedOn, 'long')}</time>
              </dd>
            </>
          )}
          <dt className="text-fg-subtle">{t.common.project}</dt>
          <dd className="min-w-0 truncate" dir="auto">
            {project ? (
              <Link to={`/projects/${project.id}`} className="text-fg hover:text-accent-text">
                {project.name}
              </Link>
            ) : (
              <span className="text-fg-muted">{t.common.noProject}</span>
            )}
          </dd>
          <dt className="text-fg-subtle">{t.common.created}</dt>
          <dd className="text-fg-muted">
            <time dateTime={decision.createdAt}>{fmt.date(decision.createdAt, 'long')}</time>
          </dd>
          <dt className="text-fg-subtle">{t.common.updated}</dt>
          <dd className="text-fg-muted">
            <time dateTime={decision.updatedAt}>{fmt.relative(decision.updatedAt)}</time>
          </dd>
          <dt className="text-fg-subtle">{t.common.tags}</dt>
          <dd>
            <TagEditor tagIds={decision.tagIds} onSave={(labels) => commands.updateDecision(decision.id, { tagLabels: labels })} />
          </dd>
        </dl>

        {replacementMissing && <p className="rounded-lg border border-line-subtle bg-raised p-3 text-sm text-fg-muted">{t.memory.replacementMissing}</p>}
        {decision.status === 'superseded' && entriesOf('supersededBy').length > 0 && (
          <RelatedContent heading={false} groups={groups.filter((g) => g.key === 'supersededBy')} />
        )}

        <TextSection title={t.memory.sectionContext} text={decision.context} />
        <TextSection title={t.memory.sectionDecision} text={decision.decision} />
        <TextSection title={t.memory.sectionRationale} text={decision.rationale} />
        <TextSection title={t.memory.sectionAlternatives} text={decision.alternatives} />
        <TextSection title={t.memory.sectionConsequences} text={decision.consequences} />

        <section className="flex flex-col gap-2" aria-label={t.memory.linkedNotes}>
          <div className="flex items-center gap-2">
            <h3 className="flex-1 text-sm font-semibold text-fg">{t.memory.linkedNotes}</h3>
            <Button size="sm" icon={Link2} onClick={() => setPicker('note')}>
              {t.memory.linkNote}
            </Button>
          </div>
          {entriesOf('notes').length === 0 ? (
            <p className="text-sm text-fg-muted">{t.memory.noLinkedNotes}</p>
          ) : (
            <RelatedList entries={entriesOf('notes')} onUnlink={(e) => void unlink(e)} />
          )}
        </section>
        <section className="flex flex-col gap-2" aria-label={t.memory.linkedTasks}>
          <div className="flex items-center gap-2">
            <h3 className="flex-1 text-sm font-semibold text-fg">{t.memory.linkedTasks}</h3>
            <Button size="sm" icon={Link2} onClick={() => setPicker('task')}>
              {t.memory.linkTask}
            </Button>
          </div>
          {entriesOf('tasks').length === 0 ? (
            <p className="text-sm text-fg-muted">{t.memory.noLinkedTasks}</p>
          ) : (
            <RelatedList entries={entriesOf('tasks')} onUnlink={(e) => void unlink(e)} />
          )}
        </section>
        {(entriesOf('replaces').length > 0 || (decision.status !== 'superseded' && entriesOf('supersededBy').length > 0)) && (
          <RelatedContent
            heading={false}
            groups={groups.filter((g) => g.key === 'replaces' || (decision.status !== 'superseded' && g.key === 'supersededBy'))}
          />
        )}
      </div>
    )
  }

  return (
    <>
      <Drawer
        open={decisionId !== null}
        onOpenChange={(open) => !open && onClose()}
        title={decision?.title ?? t.memory.decisionNotFound}
        headerExtra={decision ? <OriginMark origin={decision.origin} /> : null}
        footer={
          decision ? (
            <>
              <Button icon={Pencil} onClick={() => setEditor({ open: true, decision })}>
                {t.common.edit}
              </Button>
              {transitions.length > 0 && (
                <Menu
                  label={t.memory.statusActions}
                  align="start"
                  side="top"
                  trigger={
                    <Button iconEnd={ChevronDown} loading={busy}>
                      {t.memory.statusActions}
                    </Button>
                  }
                >
                  {transitions.map((s) => (
                    <MenuItem key={s} icon={statusAction[s].icon} onSelect={() => void changeStatus(s)}>
                      {statusAction[s].label}
                    </MenuItem>
                  ))}
                </Menu>
              )}
              <Button variant="ghost" icon={Trash2} className="text-danger" onClick={() => setConfirmDelete(true)}>
                {t.memory.deleteDecision}
              </Button>
              <Button className="ms-auto" onClick={onClose}>
                {t.common.close}
              </Button>
            </>
          ) : (
            <Button className="ms-auto" onClick={onClose}>
              {t.common.close}
            </Button>
          )
        }
      >
        {body}
      </Drawer>
      <DecisionEditorDialog state={editor} onClose={() => setEditor((s) => ({ ...s, open: false }))} />
      {decision && (
        <>
          <SupersedeDialog decision={decision} open={supersede} onClose={() => setSupersede(false)} />
          <LinkPickerDialog
            open={picker === 'note'}
            title={t.memory.notePickerForDecisionTitle}
            searchLabel={t.memory.notePickerSearch}
            emptyText={t.memory.notePickerEmpty}
            options={noteOptions}
            onPick={async (id) => {
              await commands.linkDecision({ decisionId: decision.id, targetType: 'item', targetId: id })
              toast({ title: t.memory.linkAdded, tone: 'success' })
            }}
            onClose={() => setPicker(null)}
          />
          <LinkPickerDialog
            open={picker === 'task'}
            title={t.memory.taskPickerTitle}
            searchLabel={t.memory.taskPickerSearch}
            emptyText={t.memory.taskPickerEmpty}
            options={taskOptions}
            onPick={async (id) => {
              await commands.linkDecision({ decisionId: decision.id, targetType: 'task', targetId: id })
              toast({ title: t.memory.linkAdded, tone: 'success' })
            }}
            onClose={() => setPicker(null)}
          />
          <ConfirmDialog
            open={confirmDelete}
            title={t.memory.deleteDecisionTitle(decision.title)}
            description={t.memory.deleteDecisionBody}
            confirmLabel={t.memory.deleteConfirm}
            busy={busy}
            onConfirm={() => void remove()}
            onCancel={() => setConfirmDelete(false)}
          />
        </>
      )}
    </>
  )
}
