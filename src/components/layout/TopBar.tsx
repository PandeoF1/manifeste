import { Link, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, Info, List, Map as MapIcon, Megaphone } from 'lucide-react'
import { usePanelHidden } from '@/lib/uiPrefs'
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

/** Compteur national compact (barre du haut, ordinateur). */
function MiniCounter() {
  const { data } = useQuery(statusesQuery)
  if (!data) return null
  const bloque = data.filter((s) => s.status === 'bloque').length
  return (
    <span
      className="hidden items-center gap-1.5 text-sm lg:inline-flex"
      aria-label={`${bloque} établissements bloqués`}
    >
      <StatusIcon status="bloque" size={14} />
      <strong className="tabular-nums text-bloque">{bloque}</strong> bloqués
    </span>
  )
}

/** Languette qui replie ou rouvre la barre du haut (carte uniquement). */
function BarTab({ hidden, onClick }: { hidden: boolean; onClick: () => void }) {
  const Icon = hidden ? ChevronDown : ChevronUp
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={!hidden}
      aria-label={hidden ? 'Afficher la barre du haut' : 'Masquer la barre du haut'}
      className="glass absolute top-full left-1/2 z-20 grid h-5 w-12 -translate-x-1/2 place-items-center rounded-b-lg border border-t-0 border-border text-muted hover:text-fg"
    >
      <Icon size={14} aria-hidden="true" />
    </button>
  )
}

export function TopBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [hidden, toggle] = usePanelHidden('top')
  const onMap = pathname === '/'
  const onList = pathname === '/liste'
  if (onMap && hidden) {
    // Barre repliée : il ne reste que la zone sûre (encoche) et la languette pour la rouvrir.
    return (
      <div className="relative z-20 shrink-0" style={{ height: 'env(safe-area-inset-top)' }}>
        <BarTab hidden onClick={toggle} />
      </div>
    )
  }
  return (
    <header
      className="relative z-20 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-bg px-2 md:px-4"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      {onMap && <BarTab hidden={false} onClick={toggle} />}
      {/* Téléphone : bascule carte / liste et droits, en haut à gauche. */}
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
