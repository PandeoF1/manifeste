import { Link, useRouterState } from '@tanstack/react-router'
import { Plus } from 'lucide-react'

/**
 * Téléphone : bouton flottant « Signaler » en bas à droite, à portée de pouce. Masqué là où il
 * gênerait : page de signalement, admin, et fiche d'un lycée ouverte sur la carte.
 */
export function ReportFab() {
  const { pathname, uai } = useRouterState({
    select: (s) => ({
      pathname: s.location.pathname,
      uai: (s.location.search as { uai?: string }).uai,
    }),
  })
  if (pathname.startsWith('/signaler') || pathname.startsWith('/admin')) return null
  if (pathname === '/' && uai) return null
  return (
    <Link
      to="/signaler"
      search={{}}
      className="fab fixed right-4 z-30 inline-flex h-14 items-center gap-2 rounded-full bg-bloque pr-5 pl-4 text-base font-bold text-white md:hidden"
      style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
    >
      <Plus size={24} strokeWidth={2.75} aria-hidden="true" />
      Signaler
    </Link>
  )
}
