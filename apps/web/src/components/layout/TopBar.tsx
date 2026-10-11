import { Link, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Info, List, Map as MapIcon, Megaphone } from 'lucide-react'
import { blockedPhrase } from '@/lib/labels'
import { statusesQuery } from '@/queries/statuses'
import { StatusIcon } from '@/components/status/StatusIcon'
import { RightsButton } from './RightsDialog'
import { ThemeToggle } from './ThemeToggle'

const NAV = [
  { to: '/', label: 'Carte' },
  { to: '/liste', label: 'Liste' },
  { to: '/donnees', label: 'Données' },
  { to: '/a-propos', label: 'À propos' },
] as const

/** Compact national counter (top bar, desktop). */
function MiniCounter() {
  const { data } = useQuery(statusesQuery)
  if (!data) return null
  const bloque = data.filter((s) => s.status === 'blocked').length
  return (
    <span
      className="hidden items-center gap-1.5 text-sm lg:inline-flex"
      aria-label={`${bloque} établissements ${blockedPhrase(bloque)}`}
    >
      <StatusIcon status="blocked" size={14} />
      <strong className="tabular-nums text-bloque">{bloque}</strong> {blockedPhrase(bloque)}
    </span>
  )
}

export function TopBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const onList = pathname === '/liste'
  return (
    <header
      className="relative z-20 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-bg px-2 md:px-4"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      {/* Phone: map / list switch and rights, top left. */}
      <div className="flex items-center md:hidden">
        <Link
          to={onList ? '/' : '/liste'}
          search={{}}
          aria-label={onList ? 'Voir la carte' : 'Voir la liste des établissements'}
          className="icon-btn"
        >
          {onList ? (
            <MapIcon size={22} aria-hidden="true" />
          ) : (
            <List size={22} aria-hidden="true" />
          )}
        </Link>
        {!pathname.startsWith('/admin') && <RightsButton className="icon-btn" />}
      </div>
      <Link
        to="/"
        search={{}}
        className="flex items-center gap-2 text-lg font-black tracking-tight uppercase max-md:absolute max-md:left-1/2 max-md:-translate-x-1/2"
      >
        <img src="/favicon.svg" alt="" width={28} height={28} className="rounded-md" />
        Manifeste
      </Link>
      {/* Desktop: navigation in the centre. */}
      <nav aria-label="Navigation principale" className="hidden items-center gap-1 text-sm md:flex">
        {NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            search={{}}
            className="rounded-md px-3 py-3 hover:bg-surface"
            activeProps={{
              className: 'font-semibold text-fg underline underline-offset-8',
              'aria-current': 'page',
            }}
            activeOptions={{ includeSearch: false }}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="flex items-center gap-1 md:gap-3">
        <MiniCounter />
        {!pathname.startsWith('/admin') && <ThemeToggle />}
        {!pathname.startsWith('/admin') && (
          <RightsButton className="hidden min-h-11 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm hover:bg-surface md:inline-flex" />
        )}
        <Link
          to="/signaler"
          search={{}}
          className="hidden min-h-11 items-center gap-1.5 rounded-full bg-bloque px-4 font-bold text-white md:inline-flex"
        >
          <Megaphone size={16} aria-hidden="true" /> Signaler
        </Link>
        <Link
          to="/a-propos"
          search={{}}
          aria-label="À propos"
          className="icon-btn md:hidden"
          activeProps={{ className: 'text-bloque', 'aria-current': 'page' }}
        >
          <Info size={22} aria-hidden="true" />
        </Link>
      </div>
    </header>
  )
}
