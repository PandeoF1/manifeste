import { Link } from '@tanstack/react-router'
import { Megaphone } from 'lucide-react'

export function TopBar() {
  return (
    <header
      className="relative z-20 flex h-12 shrink-0 items-center justify-between border-b border-border bg-bg px-4"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <Link
        to="/"
        search={{}}
        className="flex items-center gap-2 text-base font-black tracking-tight uppercase"
      >
        <svg width="18" height="18" viewBox="0 0 32 32" aria-hidden="true">
          <polygon
            points="11,3 21,3 29,11 29,21 21,29 11,29 3,21 3,11"
            fill="var(--status-bloque)"
          />
          <rect x="9" y="14" width="14" height="4" fill="#fff" />
        </svg>
        Manifest
      </Link>
      <nav aria-label="Navigation principale" className="flex items-center gap-1 text-sm">
        <Link
          to="/"
          search={{}}
          className="hidden rounded-md px-3 py-3 hover:bg-surface sm:block"
          activeProps={{ className: 'font-semibold', 'aria-current': 'page' }}
          activeOptions={{ includeSearch: false }}
        >
          Carte
        </Link>
        <Link
          to="/a-propos"
          className="rounded-md px-3 py-3 hover:bg-surface"
          activeProps={{ className: 'font-semibold', 'aria-current': 'page' }}
        >
          À propos
        </Link>
        <Link
          to="/signaler"
          search={{}}
          className="ml-1 inline-flex min-h-10 items-center gap-1.5 rounded-full bg-bloque px-4 font-bold text-white"
          activeProps={{ 'aria-current': 'page' }}
        >
          <Megaphone size={16} aria-hidden="true" /> Signaler
        </Link>
      </nav>
    </header>
  )
}
