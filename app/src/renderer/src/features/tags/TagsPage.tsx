import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ArrowLeft, Pencil, Tags, Trash2 } from 'lucide-react'
import { Button, buttonClass, EmptyState, IconButton, Input, Panel, Tag, useToast } from '@/design-system/components'
import { ConfirmDialog } from '@/features/shared/ConfirmDialog'
import { Page, PageHeader } from '@/features/shared/PageHeader'
import { useSaveError } from '@/features/shared/useSaveError'
import { validateTitle } from '@/features/shared/validation'
import { RelatedList } from '@/features/memory/RelatedContent'
import { TAG_MAX } from '@shared/limits'
import { useI18n } from '@/state/preferences'
import { SaveError, useWorkspace } from '@/state/workspace'
import { recordsWithTag, tagUsage, type TagUsage } from '@/state/memory'
import type { Id } from '@shared/domain'

function RenameRow({ usage, onDone }: { usage: TagUsage; onDone: () => void }) {
  const { t } = useI18n()
  const { commands } = useWorkspace()
  const toast = useToast()
  const saveError = useSaveError()
  const [label, setLabel] = useState(usage.tag.label)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (saving) return
    if (!label.trim()) return setError(t.tagsPage.nameEmpty)
    setSaving(true)
    try {
      await commands.renameTag(usage.tag.id, label)
      toast({ title: t.tagsPage.renamed, tone: 'success' })
      onDone()
    } catch (err) {
      if (err instanceof SaveError && err.code === 'conflict') setError(t.tagsPage.nameTaken)
      else saveError(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-1 flex-col gap-1">
      <div className="flex items-center gap-2">
        <Input
          aria-label={t.tagsPage.renameLabel(usage.tag.label)}
          aria-invalid={Boolean(error)}
          dir="auto"
          autoFocus
          maxLength={TAG_MAX}
          value={label}
          onChange={(e) => {
            setLabel(e.target.value)
            setError(null)
          }}
          className="h-7"
        />
        <Button size="sm" variant="primary" type="submit" loading={saving}>
          {t.common.save}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone} disabled={saving}>
          {t.common.cancel}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </form>
  )
}

export default function TagsPage() {
  const { t, fmt } = useI18n()
  const { data, commands } = useWorkspace()
  const toast = useToast()
  const saveError = useSaveError()
  const [params, setParams] = useSearchParams()
  const [draft, setDraft] = useState('')
  const [draftError, setDraftError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [renaming, setRenaming] = useState<Id | null>(null)
  const [deleting, setDeleting] = useState<TagUsage | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const usage = tagUsage(data)
  const selectedId = params.get('tag')
  const selected = usage.find((u) => u.tag.id === selectedId)
  const records = selected ? recordsWithTag(data, selected.tag.id) : null

  const add = async (e: FormEvent) => {
    e.preventDefault()
    if (adding) return
    const label = draft.replace(/^#/, '').trim()
    if (validateTitle(label) === 'empty') return setDraftError(t.tagsPage.nameEmpty)
    setAdding(true)
    try {
      const tag = await commands.createTag(label)
      toast({
        title: data.tags.some((x) => x.id === tag.id) ? t.tagsPage.existing(tag.label) : t.tagsPage.created(tag.label),
        tone: 'success'
      })
      setDraft('')
      setDraftError(null)
    } catch (err) {
      saveError(err)
    } finally {
      setAdding(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleting || deleteBusy) return
    setDeleteBusy(true)
    try {
      await commands.deleteTag(deleting.tag.id)
      toast({ title: t.tagsPage.deleted, tone: 'info' })
      if (selectedId === deleting.tag.id) setParams({}, { replace: true })
      setDeleting(null)
    } catch (err) {
      saveError(err)
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <Page>
      <Link to="/library" className={buttonClass('ghost', 'sm', '-ms-2.5 mb-3')}>
        <ArrowLeft size={14} aria-hidden className="flip-rtl" />
        {t.tagsPage.backToLibrary}
      </Link>
      <PageHeader title={t.tagsPage.title} description={t.tagsPage.description} />

      <form onSubmit={add} noValidate className="mb-2 flex items-start gap-2">
        <div className="flex max-w-sm flex-1 flex-col gap-1">
          <Input
            aria-label={t.tagsPage.newLabel}
            placeholder={t.tagsPage.newPlaceholder}
            dir="auto"
            maxLength={TAG_MAX}
            aria-invalid={Boolean(draftError)}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              setDraftError(null)
            }}
          />
          {draftError && (
            <p role="alert" className="text-xs text-danger">
              {draftError}
            </p>
          )}
        </div>
        <Button type="submit" variant="primary" loading={adding}>
          {t.tagsPage.add}
        </Button>
      </form>
      <p className="mb-5 text-xs text-fg-subtle">{t.tagsPage.policy}</p>

      {usage.length === 0 ? (
        <EmptyState icon={Tags} title={t.tagsPage.emptyTitle} description={t.tagsPage.emptyHint} />
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <Panel title={t.tagsPage.title} icon={Tags} id="tags-list" bodyClassName="p-1.5">
            <ul className="divide-y divide-line-subtle">
              {usage.map((u) => (
                <li key={u.tag.id} className="flex items-center gap-3 px-3 py-2">
                  {renaming === u.tag.id ? (
                    <RenameRow usage={u} onDone={() => setRenaming(null)} />
                  ) : (
                    <>
                      <div className="min-w-0 flex-1">
                        <Tag
                          active={selectedId === u.tag.id}
                          onClick={() => setParams({ tag: u.tag.id }, { replace: true })}
                          title={t.tagsPage.browseTitle(u.tag.label)}
                        >
                          {u.tag.label}
                        </Tag>
                        <p className="num mt-0.5 text-xs text-fg-subtle">
                          {u.notes + u.decisions === 0
                            ? t.tagsPage.unused
                            : t.tagsPage.usage(fmt.number(u.notes), fmt.number(u.decisions))}
                        </p>
                      </div>
                      <IconButton icon={Pencil} size="sm" label={t.tagsPage.renameLabel(u.tag.label)} onClick={() => setRenaming(u.tag.id)} />
                      <IconButton icon={Trash2} size="sm" label={t.tagsPage.deleteLabel(u.tag.label)} onClick={() => setDeleting(u)} />
                    </>
                  )}
                </li>
              ))}
            </ul>
          </Panel>

          {selected && records && (
            <Panel title={t.tagsPage.browseTitle(selected.tag.label)} id="tags-browse" bodyClassName="p-4">
              {records.items.length + records.decisions.length === 0 ? (
                <p className="text-sm text-fg-muted">{t.tagsPage.browseEmpty}</p>
              ) : (
                <div className="flex flex-col gap-4">
                  {records.items.length > 0 && (
                    <section className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-medium text-fg-subtle">{t.tagsPage.browseNotes}</h3>
                        <Link to={`/library?tag=${encodeURIComponent(selected.tag.id)}`} className="text-xs text-accent-text hover:underline">
                          {t.common.viewAll}
                        </Link>
                      </div>
                      <RelatedList entries={records.items.map((record) => ({ type: 'item' as const, record }))} />
                    </section>
                  )}
                  {records.decisions.length > 0 && (
                    <section className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-medium text-fg-subtle">{t.tagsPage.browseDecisions}</h3>
                        <Link to={`/decisions?tag=${encodeURIComponent(selected.tag.id)}`} className="text-xs text-accent-text hover:underline">
                          {t.common.viewAll}
                        </Link>
                      </div>
                      <RelatedList entries={records.decisions.map((record) => ({ type: 'decision' as const, record }))} />
                    </section>
                  )}
                </div>
              )}
            </Panel>
          )}
        </div>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={deleting ? t.tagsPage.deleteTitle(deleting.tag.label) : ''}
        description={deleting ? t.tagsPage.deleteBody(fmt.number(deleting.notes + deleting.decisions)) : ''}
        confirmLabel={t.tagsPage.delete}
        busy={deleteBusy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      />
    </Page>
  )
}
