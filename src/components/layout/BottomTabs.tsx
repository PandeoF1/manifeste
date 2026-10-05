import { Link } from '@tanstack/react-router'
import { Info, List, Map as MapIcon, Megaphone } from 'lucide-react'

const TABS = [
  { to: '/', label: 'Carte', icon: MapIcon },
  { to: '/liste', label: 'Liste', icon: List },
  { to: '/signaler', label: 'Signaler', icon: Megaphone, primary: true },
  { to: '/a-propos', label: 'À propos', icon: Info },
] as const

/** Barre d'onglets du téléphone (zones tactiles >= 48 px, safe area iOS). */
export function BottomTabs() {
  return (
    <nav
      aria-label="Navigation principale"
      className="z-20 shrink-0 border-t border-border bg-bg md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="grid grid-cols-4">
        {TABS.map(({ to, label, icon: Icon, ...rest }) => {
          const primary = 'primary' in rest
          return (
            <li key={to}>
              <Link
                to={to}
                search={{}}
                activeOptions={{ includeSearch: false }}
                className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs text-muted"
                activeProps={{ className: 'font-semibold text-fg', 'aria-current': 'page' }}
              >
                <span
                  className={
                    primary
                      ? 'grid size-9 place-items-center rounded-full bg-bloque text-white shadow-lg'
                      : 'grid size-7 place-items-center'
                  }
                >
                  <Icon size={primary ? 20 : 22} aria-hidden="true" />
                </span>
                {label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
