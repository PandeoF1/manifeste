export const PAGES = ['carte', 'liste', 'lycee', 'signaler', 'a-propos', 'autre'] as const
export type PageGroup = (typeof PAGES)[number]

/** Type de page envoyé aux statistiques : jamais l'adresse exacte (ni le lycée consulté). */
export function pageGroup(pathname: string): PageGroup | null {
  if (pathname.startsWith('/admin')) return null
  if (pathname === '/' || pathname === '') return 'carte'
  if (pathname.startsWith('/liste')) return 'liste'
  if (pathname.startsWith('/lycee/')) return 'lycee'
  if (pathname.startsWith('/signaler')) return 'signaler'
  if (pathname.startsWith('/a-propos')) return 'a-propos'
  return 'autre'
}
