import { useEffect, useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  BadgeCheck,
  ChartColumn,
  Flag,
  Menu,
  Newspaper,
  Rss,
  Route as RouteIcon,
  ScrollText,
  School,
  Scale,
  Settings,
  Siren,
  ShieldCheck,
  Sparkles,
  Unlink,
  Users,
  Workflow,
  X,
  LogOut,
  Megaphone,
  type LucideIcon,
  MapPinned,
} from 'lucide-react'
import { groupsFor, TAB_HINTS, TAB_LABELS, type Tab } from '@/lib/adminTabs'
import type { StaffSessionUser } from '@/lib/auth'
import { pendingQuery, proposalsQuery, unmatchedQuery } from '@/queries/admin'

const ICONS: Record<Tab, LucideIcon> = {
  moderation: ShieldCheck,
  lycees: School,
  'non-rattaches': Unlink,
  signaux: Flag,
  pipeline: Workflow,
  sources: Rss,
  domaines: BadgeCheck,
  mouvements: RouteIcon,
  parcours: MapPinned,
  mobilisations: Siren,
  stats: ChartColumn,
  medias: Newspaper,
  tweets: Megaphone,
  ia: Sparkles,
  juge: Scale,
  reglages: Settings,
  journal: ScrollText,
  equipe: Users,
}

/** How many items wait in the three queues a moderator works through. */
function useBadges(): Partial<Record<Tab, number>> {
  const pending = useQuery(pendingQuery)
  const proposals = useQuery(proposalsQuery)
  const unmatched = useQuery(unmatchedQuery)
  return {
    moderation: pending.data?.length,
    lycees: proposals.data?.length,
    'non-rattaches': unmatched.data?.length,
  }
}

/**
 * The admin frame: a sidebar with grouped sections (a drawer on a phone), the page title with a
 * line saying what the page is for, and the content. The account and sign-out sit at the bottom.
 */
export function AdminShell({
  user,
  tab,
  onSignOut,
  children,
}: {
  user: StaffSessionUser
  tab: Tab
  onSignOut: () => void
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const badges = useBadges()
  const groups = groupsFor(user.role)
  const Icon = ICONS[tab]

  useEffect(() => {
    document.title = `${TAB_LABELS[tab]} - Admin - Manifeste`
    return () => {
      document.title = 'Map des blocus : lycées et facs bloqués en direct - Manifeste'
    }
  }, [tab])

  return (
    <main className="flex min-h-0 flex-1 flex-col md:flex-row">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 md:hidden">
        <button
          type="button"
          className="icon-btn"
          aria-expanded={open}
          aria-controls="admin-nav"
          aria-label={open ? 'Fermer le menu' : 'Ouvrir le menu'}
          onClick={() => setOpen(!open)}
        >
          {open ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
        </button>
        <span className="flex items-center gap-2 font-bold">
          <Icon size={18} aria-hidden="true" /> {TAB_LABELS[tab]}
        </span>
      </div>

      <aside
        id="admin-nav"
        className={`${open ? 'flex' : 'hidden'} min-h-0 flex-col overflow-hidden border-b border-border bg-surface md:flex md:w-64 md:shrink-0 md:border-r md:border-b-0`}
      >
        <p className="hidden px-4 pt-4 pb-2 text-lg font-black md:block">
          {user.role === 'admin' ? 'Administration' : 'Modération'}
        </p>
        <nav aria-label="Sections" className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 py-2">
          {groups.map((group) => (
            <div key={group.id}>
              <p className="px-2 pb-1 text-xs font-semibold tracking-wider text-muted uppercase">
                {group.label}
              </p>
              <ul className="space-y-0.5">
                {group.tabs.map((t) => {
                  const TabIcon = ICONS[t]
                  const count = badges[t]
                  return (
                    <li key={t}>
                      <Link
                        to="/admin"
                        search={{ tab: t }}
                        onClick={() => setOpen(false)}
                        className="flex min-h-11 items-center gap-2 rounded-md px-2 text-sm hover:bg-bg md:min-h-8"
                        activeOptions={{ includeSearch: true }}
                        activeProps={{
                          className:
                            'bg-bg font-semibold shadow-[inset_3px_0_0_var(--color-accent)]',
                          'aria-current': 'page',
                        }}
                      >
                        <TabIcon size={18} aria-hidden="true" className="shrink-0 text-muted" />
                        <span className="flex-1">{TAB_LABELS[t]}</span>
                        {count ? (
                          <span className="rounded-full bg-bloque px-2 text-xs font-bold text-white">
                            {count}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="space-y-2 border-t border-border p-3 text-sm">
          <p className="truncate text-muted" title={user.email}>
            {user.email}
          </p>
          <button type="button" className="btn-secondary w-full" onClick={onSignOut}>
            <LogOut size={16} aria-hidden="true" className="mr-1.5 inline" /> Se déconnecter
          </button>
        </div>
      </aside>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
          <header className="space-y-1">
            <h1 className="flex items-center gap-2 text-2xl font-black">
              <Icon size={24} aria-hidden="true" className="hidden text-muted md:block" />
              {TAB_LABELS[tab]}
            </h1>
            <p className="text-muted">{TAB_HINTS[tab]}</p>
          </header>
          {children}
        </div>
      </div>
    </main>
  )
}
