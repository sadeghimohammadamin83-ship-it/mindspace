import { motion } from 'motion/react'
import type { KnowledgeItem } from '@shared/domain'
import { Tag } from '@/design-system/components'
import { TRANSITION } from '@/design-system/motion'
import { cn } from '@/lib/cn'
import { useI18n } from '@/state/preferences'
import { useWorkspace } from '@/state/workspace'
import { tagMap } from '@/state/selectors'
import { KindIcon, OriginMark } from './meta'
import { ProjectLink } from './TaskRow'

/** A knowledge item as a list row; the title opens the item. */
export function ItemRow({
  item,
  onOpen,
  timestamp = 'updatedAt',
  showBody = true,
  showTags = true,
  dense
}: {
  item: KnowledgeItem
  onOpen: (item: KnowledgeItem) => void
  timestamp?: 'updatedAt' | 'createdAt'
  showBody?: boolean
  showTags?: boolean
  dense?: boolean
}) {
  const { t, fmt } = useI18n()
  const { data } = useWorkspace()
  const tags = tagMap(data.tags)
  return (
    <motion.article
      layout="position"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0 } }}
      transition={{ opacity: TRANSITION.base, layout: TRANSITION.layout }}
      className={cn('group relative flex gap-3 rounded-md px-3 transition-colors hover:bg-hover/60', dense ? 'py-2' : 'py-3')}>
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-line-subtle bg-raised">
        <KindIcon kind={item.kind} size={14} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="min-w-0 flex-1 truncate text-base font-medium text-fg" dir="auto">
            <button
              type="button"
              onClick={() => onOpen(item)}
              className="max-w-full truncate rounded-sm text-start after:absolute after:inset-0 after:content-['']"
            >
              {item.title}
            </button>
          </h3>
          <OriginMark origin={item.origin} />
          <time dateTime={item[timestamp]} className="shrink-0 text-xs text-fg-subtle">
            {fmt.relative(item[timestamp])}
          </time>
        </div>
        {showBody && item.body && (
          <p className="mt-0.5 line-clamp-1 text-sm text-fg-muted" dir="auto">
            {item.body}
          </p>
        )}
        {!dense && (
          <div className="relative z-10 mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="text-xs text-fg-subtle">{t.kinds[item.kind]}</span>
            <ProjectLink id={item.projectId} />
            {showTags &&
              item.tagIds.slice(0, 3).map((id) => {
                const tag = tags.get(id)
                return tag ? <Tag key={id}>{tag.label}</Tag> : null
              })}
          </div>
        )}
      </div>
    </motion.article>
  )
}
