import type { Id } from '@shared/domain'
import { Select } from '@/design-system/components'
import { useI18n } from '@/state/preferences'
import { useWorkspace } from '@/state/workspace'
import { sortProjects } from '@/state/selectors'

const NONE = 'none'

/** Project picker; completed projects are hidden unless already selected. */
export function ProjectSelect({
  id,
  value,
  onChange,
  describedBy
}: {
  id?: string
  value: Id | null
  onChange: (id: Id | null) => void
  describedBy?: string | undefined
}) {
  const { t } = useI18n()
  const { data } = useWorkspace()
  const projects = sortProjects(data.projects).filter((p) => p.status !== 'completed' || p.id === value)
  return (
    <Select
      {...(id ? { id } : {})}
      {...(describedBy ? { 'aria-describedby': describedBy } : {})}
      value={value ?? NONE}
      onChange={(v) => onChange(v === NONE ? null : v)}
      options={[{ value: NONE, label: t.common.noProject }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
    />
  )
}
