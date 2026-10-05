import { Link, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Info, List, Map as MapIcon, Megaphone } from 'lucide-react'
import { statusesQuery } from '@/queries/statuses'
import { StatusIcon } from '@/components/status/StatusIcon'

const NAV = [
  { to: '/', label: 'Carte' },
  { to: '/liste', label: 'Liste' },
  { to: '/a-propos', label: 'À propos' },
] as const

/** Compteur national compact (barre du haut, ordinateur). */
function MiniCounter() {
  const { data } = useQuery(statusesQuery)
  if (!data) return null
  const bloque = data.filter((s) => s.status === 'bloque').length
  return (
    <span
      className="hidden items-center gap-1.5 text-sm lg:inline-flex"
      aria-label={`${bloque} lycées bloqués`}
    >
      <StatusIcon status="bloque" size={14} />
      <strong className="tabular-nums text-bloque">{bloque}</strong> bloqués
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
      {/* Téléphone : bascule carte / liste en haut à gauche. */}
      <Link
        to={onList ? '/' : '/liste'}
        search={{}}
        aria-label={onList ? 'Voir la carte' : 'Voir la liste des lycées'}
        className="icon-btn md:hidden"
      >
        {onList ? <MapIcon size={22} aria-hidden="true" /> : <List size={22} aria-hidden="true" />}
      </Link>
      <Link
        to="/"
        search={{}}
        className="flex items-center gap-2 text-lg font-black tracking-tight uppercase max-md:absolute max-md:left-1/2 max-md:-translate-x-1/2"
      >
        <img src="/favicon.svg" alt="" width={28} height={28} className="rounded-md" />
        Manifeste
      </Link>
      {/* Ordinateur : navigation au centre. */}
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
      <div className="flex items-center gap-4">
        <MiniCounter />
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
