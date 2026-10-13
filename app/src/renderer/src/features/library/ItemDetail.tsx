import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Copy, ExternalLink, FileQuestion, FolderKanban, Gavel } from 'lucide-react'
import type { KnowledgeItem } from '@shared/domain'
import { Badge, Button, buttonClass, Drawer, EmptyState, IconButton, useToast } from '@/design-system/components'
import { DecisionEditorDialog, type DecisionEditorState } from '@/features/memory/DecisionEditorDialog'
import { RelatedContent } from '@/features/memory/RelatedContent'
import { TagEditor } from '@/features/memory/TagEditor'
import { KIND_ICON, OriginMark } from '@/features/shared/meta'
import { useI18n } from '@/state/preferences'
import { useWorkspace } from '@/state/workspace'
import { findProject } from '@/state/selectors'
import { relatedForItem } from '@/state/memory'

/** Side drawer showing one knowledge item. */
export function ItemDetail({
  itemId,
  onClose,
  onTagClick
}: {
  itemId: string | null
  onClose: () => void
  onTagClick: (tagId: string) => void
}) {
  const { t, fmt } = useI18n()
  const { data, commands } = useWorkspace()
  const navigate = useNavigate()
  const [editor, setEditor] = useState<DecisionEditorState>({ open: false })
  const toast = useToast()
  const item: KnowledgeItem | undefined = itemId ? data.items.find((i) => i.id === itemId) : undefined
  const project = item ? findProject(data, item.projectId) : undefined

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast({ title: t.common.copied, tone: 'info' })
    } catch {
      toast({ title: t.common.copyFailed, tone: 'error' })
    }
  }

  const Icon = item ? KIND_ICON[item.kind] : FileQuestion

  return (
    <>
    <Drawer
      open={itemId !== null}
      onOpenChange={(open) => !open && onClose()}
      title={item?.title ?? t.library.itemNotFound}
      headerExtra={item ? <OriginMark origin={item.origin} /> : null}
      footer={
        <>
          {project && (
            <Link to={`/projects/${project.id}`} className={buttonClass('ghost', 'sm')}>
              <FolderKanban size={14} strokeWidth={1.75} aria-hidden />
              {t.library.openProject}
            </Link>
          )}
          {item && (
            <Button icon={Gavel} onClick={() => setEditor({ open: true, defaults: { projectId: item.projectId, noteIds: [item.id] } })}>
              {t.memory.newDecision}
            </Button>
          )}
          <Button className="ms-auto" onClick={onClose}>
            {t.common.close}
          </Button>
        </>
      }
    >
      {!item ? (
        <EmptyState icon={FileQuestion} title={t.library.itemNotFound} />
      ) : (
        <div className="flex flex-col gap-6">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-sm">
            <dt className="text-fg-subtle">{t.common.type}</dt>
            <dd>
              <Badge tone={item.kind === 'decision' || item.kind === 'idea' ? 'accent' : 'neutral'} icon={Icon}>
                {t.kinds[item.kind]}
              </Badge>
            </dd>
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
              <time dateTime={item.createdAt}>{fmt.date(item.createdAt, 'long')}</time>
            </dd>
            <dt className="text-fg-subtle">{t.common.updated}</dt>
            <dd className="text-fg-muted">
              <time dateTime={item.updatedAt}>{fmt.relative(item.updatedAt)}</time>
            </dd>
            <dt className="text-fg-subtle">{t.common.tags}</dt>
            <dd>
              <TagEditor tagIds={item.tagIds} onTagClick={onTagClick} onSave={(labels) => commands.updateItem(item.id, { tagLabels: labels })} />
            </dd>
          </dl>

          {item.url && (
            <div className="rounded-lg border border-line-subtle bg-raised p-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-xs text-fg-subtle">
                <ExternalLink size={12} aria-hidden />
                {t.library.linkTarget}
              </p>
              <div className="flex items-center gap-2">
                <code dir="ltr" className="min-w-0 flex-1 truncate font-mono text-sm text-fg">
                  {item.url}
                </code>
                <IconButton icon={Copy} label={t.common.copyLink} size="sm" onClick={() => void copy(item.url ?? '')} />
              </div>
              <p className="mt-2 text-xs text-fg-subtle">{t.library.linkOpenLater}</p>
            </div>
          )}

          <div dir="auto" className="text-md leading-relaxed whitespace-pre-wrap text-fg">
            {item.body}
          </div>

          <RelatedContent groups={relatedForItem(data, item)} />
        </div>
      )}
    </Drawer>
    <DecisionEditorDialog
      state={editor}
      onClose={() => setEditor((e) => ({ ...e, open: false }))}
      onSaved={(id) => navigate(`/decisions?decision=${encodeURIComponent(id)}`)}
    />
    </>
  )
}
