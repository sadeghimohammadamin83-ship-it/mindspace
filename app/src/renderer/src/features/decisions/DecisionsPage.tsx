import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Gavel, Plus, SearchX } from 'lucide-react'
import { DECISION_STATUSES, type DecisionStatus } from '@shared/domain'
import { Button, EmptyState, Input, Select, Tag } from '@/design-system/components'
import { DecisionDetail } from '@/features/memory/DecisionDetail'
import { DecisionEditorDialog, type DecisionEditorState } from '@/features/memory/DecisionEditorDialog'
import { DecisionRow } from '@/features/memory/DecisionRow'
import { DecisionStatusGuide } from '@/features/memory/DecisionStatus'
import { Page, PageHeader } from '@/features/shared/PageHeader'
import { useI18n } from '@/state/preferences'
import { useWorkspace } from '@/state/workspace'
import { filterDecisions } from '@/state/memory'
import { sortProjects } from '@/state/selectors'

type StatusFilter = DecisionStatus | 'all'

/** All decisions. Filters and the open decision live in the URL (?q, ?status, ?project, ?tag, ?decision). */
export default function DecisionsPage() {
  const { t, fmt } = useI18n()
  const { data } = useWorkspace()
  const [params, setParams] = useSearchParams()
  const [editor, setEditor] = useState<DecisionEditorState>({ open: false })

  const text = params.get('q') ?? ''
  const statusParam = params.get('status')
  const status: StatusFilter =
    statusParam && (DECISION_STATUSES as readonly string[]).includes(statusParam) ? (statusParam as DecisionStatus) : 'all'
  const projectParam = params.get('project')
  const projectId = projectParam && data.projects.some((p) => p.id === projectParam) ? projectParam : 'all'
  const tagParam = params.get('tag')
  const tag = tagParam ? data.tags.find((x) => x.id === tagParam) : undefined
  const openId = params.get('decision')

  const update = (mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params)
    mutate(next)
    setParams(next, { replace: true })
  }
  const setOrDelete = (p: URLSearchParams, key: string, value: string) => (value ? p.set(key, value) : p.delete(key))

  const decisions = useMemo(
    () => filterDecisions(data, { text, status, projectId, tagId: tag?.id }),
    [data, text, status, projectId, tag?.id]
  )
  const filtersActive = Boolean(text) || status !== 'all' || projectId !== 'all' || Boolean(tag)

  return (
    <Page>
      <PageHeader
        title={t.memory.decisionsPageTitle}
        description={t.memory.decisionsPageDescription}
        actions={
          <>
            <DecisionStatusGuide />
            <Button variant="primary" icon={Plus} onClick={() => setEditor({ open: true })}>
              {t.memory.newDecision}
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          aria-label={t.memory.searchDecisions}
          placeholder={t.memory.searchDecisions}
          dir="auto"
          value={text}
          onChange={(e) => update((p) => setOrDelete(p, 'q', e.target.value))}
          className="max-w-72"
        />
        <Select<StatusFilter>
          aria-label={t.common.status}
          size="sm"
          className="w-40"
          value={status}
          onChange={(v) => update((p) => setOrDelete(p, 'status', v === 'all' ? '' : v))}
          options={[
            { value: 'all', label: t.memory.anyStatus },
            ...DECISION_STATUSES.map((s) => ({ value: s, label: t.memory.status[s] }))
          ]}
        />
        <Select
          aria-label={t.common.project}
          size="sm"
          className="w-48"
          value={projectId}
          onChange={(v) => update((p) => setOrDelete(p, 'project', v === 'all' ? '' : v))}
          options={[
            { value: 'all', label: t.memory.anyProject },
            ...sortProjects(data.projects).map((p) => ({ value: p.id, label: p.name }))
          ]}
        />
        {tag && (
          <Tag active onRemove={() => update((p) => p.delete('tag'))} removeLabel={t.common.clear}>
            {tag.label}
          </Tag>
        )}
        {data.decisions.length > 0 && (
          <p className="num ms-auto text-sm text-fg-subtle">
            {t.memory.countOf(fmt.number(decisions.length), fmt.number(data.decisions.length))}
          </p>
        )}
      </div>

      <section aria-label={t.memory.decisionsPageTitle} className="rounded-xl border border-line-subtle bg-surface p-1.5">
        {data.decisions.length === 0 ? (
          <EmptyState
            icon={Gavel}
            title={t.memory.decisionsEmpty}
            description={t.memory.decisionsEmptyHint}
            action={
              <Button variant="primary" icon={Plus} onClick={() => setEditor({ open: true })}>
                {t.memory.newDecision}
              </Button>
            }
          />
        ) : decisions.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title={t.memory.noMatch}
            description={t.memory.noMatchHint}
            action={
              filtersActive ? (
                <Button onClick={() => setParams(new URLSearchParams(openId ? { decision: openId } : {}), { replace: true })}>
                  {t.common.clearFilters}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="divide-y divide-line-subtle">
            {decisions.map((d) => (
              <DecisionRow key={d.id} decision={d} onOpen={(x) => update((p) => p.set('decision', x.id))} />
            ))}
          </div>
        )}
      </section>

      <DecisionDetail decisionId={openId} onClose={() => update((p) => p.delete('decision'))} />
      <DecisionEditorDialog
        state={editor}
        onClose={() => setEditor((s) => ({ ...s, open: false }))}
        onSaved={(id) => update((p) => p.set('decision', id))}
      />
    </Page>
  )
}
