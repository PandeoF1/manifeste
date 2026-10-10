export const PAGES = [
  'carte',
  'liste',
  'lycee',
  'signaler',
  'a-propos',
  'donnees',
  'autre',
] as const
export type PageGroup = (typeof PAGES)[number]

/** Page type sent to the statistics: never the exact address (nor the school viewed). */
export function pageGroup(pathname: string): PageGroup | null {
  // Pages embedded on other sites: neither visits nor "online" (they would skew the stats).
  if (pathname.startsWith('/admin') || pathname.startsWith('/embed')) return null
  if (pathname === '/' || pathname === '') return 'carte'
  if (pathname.startsWith('/liste')) return 'liste'
  if (pathname.startsWith('/lycee/')) return 'lycee'
  if (pathname.startsWith('/signaler')) return 'signaler'
  if (pathname.startsWith('/a-propos')) return 'a-propos'
  if (pathname.startsWith('/donnees')) return 'donnees'
  // Unknown address (page not found, broken link): grouped, never kept.
  return 'autre'
}
