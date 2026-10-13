import type { Ref } from 'react'
import { Link, useLocation } from 'react-router'
import { ChevronRight, HardDrive, Plus } from 'lucide-react'
import { Badge, Button, Kbd, Tooltip } from '@/design-system/components'
import { useI18n } from '@/state/preferences'
import { useWorkspace } from '@/state/workspace'
import { findProject } from '@/state/selectors'
import { ActivityPopover } from './ActivityPopover'
import { useCaptureDialog } from './CaptureDialog'
import { GlobalSearch } from './GlobalSearch'
import { navEntryFor } from './navigation'

function Breadcrumb() {
  const { t } = useI18n()
  const { pathname } = useLocation()
  const { data } = useWorkspace()
  const entry = navEntryFor(pathname)
  const projectId = pathname.startsWith('/projects/') ? decodeURIComponent(pathname.split('/')[2] ?? '') : undefined
  const project = projectId ? findProject(data, projectId) : undefined
  if (!entry) return <span className="text-base font-medium text-fg">{t.errors.notFoundTitle}</span>
  return (
    <nav aria-label={t.nav.breadcrumb} className="flex min-w-0 items-center gap-1.5 text-base">
      {project ? (
        <>
          <Link to={entry.path} className="shrink-0 rounded-sm text-fg-muted hover:text-fg">
            {t.nav[entry.key]}
          </Link>
          <ChevronRight size={14} className="shrink-0 text-fg-subtle flip-rtl" aria-hidden />
          <span aria-current="page" className="truncate font-medium text-fg" dir="auto">
            {project.name}
          </span>
        </>
      ) : (
        <span aria-current="page" className="truncate font-medium text-fg">
          {t.nav[entry.key]}
        </span>
      )}
    </nav>
  )
}

export function TopBar({ searchRef }: { searchRef: Ref<HTMLInputElement> }) {
  const { t } = useI18n()
  const openCapture = useCaptureDialog()
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line-subtle bg-canvas px-6">
      <div className="flex min-w-0 flex-[1_1_200px] items-center">
        <Breadcrumb />
      </div>
      <div className="flex flex-[2_1_320px] justify-center">
        <GlobalSearch inputRef={searchRef} />
      </div>
      <div className="flex flex-[1_1_200px] items-center justify-end gap-1.5">
        <Tooltip content={t.app.prototypeDataHint}>
          <span tabIndex={0} className="hidden rounded-full xl:inline-flex">
            <Badge tone="neutral" icon={HardDrive}>
              {t.app.prototypeData}
            </Badge>
          </span>
        </Tooltip>
        <ActivityPopover />
        <Tooltip
          content={
            <span className="inline-flex items-center gap-1.5">
              {t.topbar.captureHint}
              <Kbd>Ctrl</Kbd>
              <Kbd>Shift</Kbd>
              <Kbd>Space</Kbd>
            </span>
          }
        >
          <Button variant="primary" icon={Plus} onClick={() => openCapture()} aria-keyshortcuts="Control+Shift+Space">
            {t.topbar.capture}
          </Button>
        </Tooltip>
      </div>
    </header>
  )
}
