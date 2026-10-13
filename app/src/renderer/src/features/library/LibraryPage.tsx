import { useMemo } from 'react'
import { AnimatePresence } from 'motion/react'
import { Link, useSearchParams } from 'react-router'
import { ChevronDown, Library, Plus, Search, SearchX, Tags, X } from 'lucide-react'
import { ITEM_KINDS, type ItemKind, type KnowledgeItem } from '@shared/domain'
import { Button, buttonClass, EmptyState, Input, Popover, Segmented, Select, Tag } from '@/design-system/components'
import { useCaptureDialog } from '@/app/CaptureDialog'
import { ItemRow } from '@/features/shared/ItemRow'
import { Page, PageHeader } from '@/features/shared/PageHeader'
import { cn } from '@/lib/cn'
import { useI18n } from '@/state/preferences'
import { useWorkspace } from '@/state/workspace'
import { filterLibrary, LIBRARY_SORTS, tagMap, tagsByUsage, type LibrarySort } from '@/state/selectors'
import { ItemDetail } from './ItemDetail'

type KindFilter = ItemKind | 'all'

/**
 * Library state lives in the URL (?q, ?kind, ?tag, ?sort, ?item), so search
 * results can link here and Back restores the previous view.
 */
export default function LibraryPage() {
  const { t, fmt, locale } = useI18n()
  const { data } = useWorkspace()
  const openCapture = useCaptureDialog()
  const [params, setParams] = useSearchParams()

  const text = params.get('q') ?? ''
  const kindParam = params.get('kind')
  const kind: KindFilter = kindParam && (ITEM_KINDS as readonly string[]).includes(kindParam) ? (kindParam as ItemKind) : 'all'
  const tagIds = params.getAll('tag').filter((id) => data.tags.some((tg) => tg.id === id))
  const sortParam = params.get('sort') as LibrarySort | null
  const sort: LibrarySort = sortParam && LIBRARY_SORTS.includes(sortParam) ? sortParam : 'updated'
  const openItemId = params.get('item')

  const update = (mutate: (p: URLSearchParams) => void, replace = true) => {
    const next = new URLSearchParams(params)
    mutate(next)
    setParams(next, { replace })
  }

  const items = useMemo(
    () => filterLibrary(data, { text, kinds: kind === 'all' ? [] : [kind], tagIds, sort }, locale),
    [data, text, kind, tagIds.join(','), sort, locale] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const kindCounts = useMemo(() => {
    const counts: Record<KindFilter, number> = { all: data.items.length, note: 0, idea: 0, link: 0, decision: 0 }
    for (const i of data.items) counts[i.kind] += 1
    return counts
  }, [data.items])
  const usage = tagsByUsage(data)
  const tags = tagMap(data.tags)
  const filtersActive = Boolean(text) || kind !== 'all' || tagIds.length > 0

  const clearFilters = () =>
    update((p) => {
      p.delete('q')
      p.delete('kind')
      p.delete('tag')
    })
  const toggleTag = (id: string) =>
    update((p) => {
      const current = p.getAll('tag')
      p.delete('tag')
      const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
      next.forEach((x) => p.append('tag', x))
    })
  const openItem = (item: KnowledgeItem) => update((p) => p.set('item', item.id), false)

  const sortLabels: Record<LibrarySort, string> = {
    updated: t.library.sortUpdated,
    created: t.library.sortCreated,
    oldest: t.library.sortOldest,
    'title-asc': t.library.sortTitleAsc,
    'title-desc': t.library.sortTitleDesc
  }

  return (
    <Page>
      <PageHeader
        title={t.library.title}
        description={t.library.description}
        actions={
          <>
            <Link to="/tags" className={buttonClass('secondary', 'md')}>
              <Tags size={16} aria-hidden strokeWidth={1.75} />
              {t.tagsPage.manage}
            </Link>
            <Button variant="primary" icon={Plus} onClick={() => openCapture()}>
              {t.topbar.capture}
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-60 flex-1">
            <Search size={15} aria-hidden className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
            <Input
              type="search"
              dir="auto"
              aria-label={t.library.searchLabel}
              placeholder={t.library.searchPlaceholder}
              value={text}
              onChange={(e) => update((p) => (e.target.value ? p.set('q', e.target.value) : p.delete('q')))}
              className="ps-9"
            />
          </div>
          <Popover
            label={t.library.filterTags}
            align="end"
            className="w-64"
            trigger={
              <Button icon={Tags} iconEnd={ChevronDown} className={cn(tagIds.length > 0 && 'border-accent-line text-accent-text')}>
                {tagIds.length ? t.library.tagsSelected(fmt.number(tagIds.length)) : t.library.anyTag}
              </Button>
            }
          >
            <fieldset className="max-h-80 overflow-y-auto p-1.5">
              <legend className="px-2 pt-1 pb-1.5 text-2xs font-semibold tracking-wide text-fg-subtle uppercase">{t.library.filterTags}</legend>
              {usage.map(({ tag, count }) => (
                <label key={tag.id} className="flex h-8 cursor-default items-center gap-2.5 rounded-md px-2 text-base text-fg hover:bg-hover">
                  <input
                    type="checkbox"
                    checked={tagIds.includes(tag.id)}
                    onChange={() => toggleTag(tag.id)}
                    className="size-3.5 accent-accent"
                  />
                  <span className="min-w-0 flex-1 truncate" dir="auto">
                    {tag.label}
                  </span>
                  <span className="num text-xs text-fg-subtle">{fmt.number(count)}</span>
                </label>
              ))}
            </fieldset>
          </Popover>
          <div className="flex items-center gap-2">
            <label htmlFor="library-sort" className="text-sm text-fg-subtle">
              {t.library.sortLabel}
            </label>
            <Select
              id="library-sort"
              value={sort}
              onChange={(v) => update((p) => (v === 'updated' ? p.delete('sort') : p.set('sort', v)))}
              options={LIBRARY_SORTS.map((s) => ({ value: s, label: sortLabels[s] }))}
              className="w-44"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            label={t.library.filterType}
            value={kind}
            onChange={(v) => update((p) => (v === 'all' ? p.delete('kind') : p.set('kind', v)))}
            options={[
              { value: 'all' as KindFilter, label: `${t.common.all} · ${fmt.number(kindCounts.all)}` },
              ...ITEM_KINDS.map((k) => ({ value: k as KindFilter, label: `${t.kindsPlural[k]} · ${fmt.number(kindCounts[k])}` }))
            ]}
            size="sm"
          />
          {tagIds.map((id) => (
            <Tag key={id} active onRemove={() => toggleTag(id)} removeLabel={t.capture.removeTag(tags.get(id)?.label ?? '')}>
              {tags.get(id)?.label}
            </Tag>
          ))}
          {filtersActive && (
            <Button variant="ghost" size="sm" icon={X} onClick={clearFilters}>
              {t.common.clearFilters}
            </Button>
          )}
          <p className="num ms-auto text-sm text-fg-subtle" aria-live="polite">
            {t.library.count(fmt.number(items.length), fmt.number(data.items.length))}
          </p>
        </div>
      </div>

      <section aria-label={t.library.title} className="rounded-xl border border-line-subtle bg-surface p-1.5">
        {data.items.length === 0 ? (
          <EmptyState icon={Library} title={t.library.emptyLibraryTitle} description={t.library.emptyLibraryHint} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title={t.library.emptyTitle}
            description={t.library.emptyHint}
            action={<Button onClick={clearFilters}>{t.common.clearFilters}</Button>}
          />
        ) : (
          <div className="divide-y divide-line-subtle">
            <AnimatePresence initial={false}>
              {items.map((item) => (
                <ItemRow key={item.id} item={item} onOpen={openItem} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </section>

      <ItemDetail
        itemId={openItemId}
        onClose={() => update((p) => p.delete('item'))}
        onTagClick={(id) =>
          update((p) => {
            p.delete('item')
            p.delete('tag')
            p.append('tag', id)
          })
        }
      />
    </Page>
  )
}
