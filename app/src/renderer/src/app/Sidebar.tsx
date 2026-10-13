import { motion } from 'motion/react'
import { NavLink, useNavigate } from 'react-router'
import { Info, Keyboard, Languages, PanelLeftClose, PanelLeftOpen, Settings2, UserRound } from 'lucide-react'
import { IconButton, Menu, MenuItem, MenuLabel, MenuRadioGroup, MenuSeparator, Tooltip } from '@/design-system/components'
import { TRANSITION } from '@/design-system/motion'
import { cn } from '@/lib/cn'
import { useI18n, usePreferences } from '@/state/preferences'
import { useWorkspace } from '@/state/workspace'
import { openTaskCount } from '@/state/selectors'
import { LogoMark } from './Logo'
import { NAV, SHORTCUT_NAV, type NavEntry } from './navigation'

function NavItem({ entry, collapsed, count, index }: { entry: NavEntry; collapsed: boolean; count?: string; index: number }) {
  const { t } = useI18n()
  const label = t.nav[entry.key]
  const Icon = entry.icon
  const link = (
    <NavLink
      to={entry.path}
      end={entry.path === '/'}
      aria-label={collapsed ? label : undefined}
      aria-keyshortcuts={index >= 0 ? `Control+${index + 1}` : undefined}
      className={({ isActive }) =>
        cn(
          'group relative flex h-8.5 items-center gap-3 rounded-md text-base transition-colors',
          collapsed ? 'justify-center px-0' : 'px-2.5',
          isActive ? 'font-medium text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg'
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.span layoutId="nav-active" transition={TRANSITION.spring} aria-hidden className="absolute inset-0 rounded-md bg-active">
              <span className="absolute inset-y-2 -start-3 w-0.5 rounded-full bg-accent" />
            </motion.span>
          )}
          <Icon size={17} strokeWidth={1.75} aria-hidden className={cn('relative', isActive && 'text-accent-text')} />
          {!collapsed && <span className="relative flex-1 truncate">{label}</span>}
          {!collapsed && count && <span className="num relative text-xs text-fg-subtle">{count}</span>}
        </>
      )}
    </NavLink>
  )
  return collapsed ? (
    <Tooltip content={label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  )
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { t, fmt, lang } = useI18n()
  const { prefs, setPref } = usePreferences()
  const { data } = useWorkspace()
  const navigate = useNavigate()

  const counts: Partial<Record<NavEntry['key'], string>> = prefs.showSidebarCounts
    ? { library: fmt.number(data.items.length), tasks: fmt.number(openTaskCount(data.tasks)) }
    : {}

  const groups = [
    { id: 'workspace', label: t.nav.groupWorkspace },
    { id: 'insight', label: t.nav.groupInsight }
  ] as const

  return (
    <aside
      aria-label={t.nav.mainNavigation}
      className={cn(
        'flex h-full shrink-0 flex-col border-e border-line-subtle bg-sidebar transition-[width]',
        collapsed ? 'w-16' : 'w-60'
      )}
    >
      <div className={cn('flex h-14 shrink-0 items-center gap-2.5', collapsed ? 'justify-center px-2' : 'px-4')}>
        {!collapsed && (
          <>
            <LogoMark />
            <div className="min-w-0 flex-1 leading-none">
              <p className="text-sm font-semibold tracking-[0.18em] text-fg" dir="ltr">
                MINDSPACE
              </p>
              <p className="mt-1 text-2xs text-fg-subtle">{t.app.tagline}</p>
            </div>
          </>
        )}
        <IconButton
          icon={collapsed ? PanelLeftOpen : PanelLeftClose}
          label={collapsed ? t.nav.expand : t.nav.collapse}
          onClick={onToggle}
          size="sm"
          flip
          aria-expanded={!collapsed}
        />
      </div>

      <nav className={cn('flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pt-3', collapsed ? 'px-2' : 'px-3')}>
        {groups.map((g) => (
          <div key={g.id} className="flex flex-col gap-0.5">
            {!collapsed && (
              <p className="px-2.5 pb-1.5 text-2xs font-semibold tracking-wider text-fg-subtle uppercase">{g.label}</p>
            )}
            {NAV.map((entry) =>
              entry.group === g.id ? (
                <NavItem
                  key={entry.key}
                  entry={entry}
                  collapsed={collapsed}
                  index={SHORTCUT_NAV.indexOf(entry)}
                  {...(counts[entry.key] ? { count: counts[entry.key] } : {})}
                />
              ) : null
            )}
          </div>
        ))}
        <div className="mt-auto flex flex-col gap-0.5 pb-2">
          {NAV.filter((n) => n.group === 'system').map((entry) => (
            <NavItem key={entry.key} entry={entry} collapsed={collapsed} index={SHORTCUT_NAV.indexOf(entry)} />
          ))}
        </div>
      </nav>

      <div className={cn('shrink-0 border-t border-line-subtle', collapsed ? 'p-2' : 'p-3')}>
        <Menu
          side="top"
          align="start"
          label={t.profile.menu}
          trigger={
            <button
              type="button"
              aria-label={t.profile.menu}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-md text-start transition-colors hover:bg-hover data-[state=open]:bg-hover',
                collapsed ? 'justify-center p-1.5' : 'p-1.5'
              )}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-line bg-raised text-fg-muted">
                <UserRound size={16} strokeWidth={1.75} aria-hidden />
              </span>
              {!collapsed && (
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-sm font-medium text-fg">{t.profile.workspace}</span>
                  <span className="block truncate text-xs text-fg-subtle">{t.profile.device}</span>
                </span>
              )}
            </button>
          }
        >
          <MenuLabel>
            <span className="inline-flex items-center gap-1.5">
              <Languages size={12} aria-hidden />
              {t.profile.language}
            </span>
          </MenuLabel>
          <MenuRadioGroup
            value={lang}
            onChange={(v) => setPref('lang', v)}
            options={[
              { value: 'fa', label: 'فارسی' },
              { value: 'en', label: 'English' }
            ]}
          />
          <MenuSeparator />
          <MenuItem icon={Settings2} onSelect={() => navigate('/settings')}>
            {t.nav.settings}
          </MenuItem>
          <MenuItem icon={Keyboard} onSelect={() => navigate('/settings#shortcuts')}>
            {t.profile.shortcuts}
          </MenuItem>
          <MenuItem icon={Info} onSelect={() => navigate('/settings#about')}>
            {t.profile.about}
          </MenuItem>
        </Menu>
      </div>
    </aside>
  )
}
