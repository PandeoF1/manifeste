export const PAGES = [
  'map',
  'list',
  'school',
  'report',
  'about',
  'data',
  'other',
] as const
export type PageGroup = (typeof PAGES)[number]

/** Page type sent to the statistics: never the exact address (nor the school viewed). */
export function pageGroup(pathname: string): PageGroup | null {
  // Pages embedded on other sites: neither visits nor "online" (they would skew the stats).
  if (pathname.startsWith('/admin') || pathname.startsWith('/embed')) return null
  if (pathname === '/' || pathname === '') return 'map'
  if (pathname.startsWith('/liste')) return 'list'
  if (pathname.startsWith('/lycee/')) return 'school'
  if (pathname.startsWith('/signaler')) return 'report'
  if (pathname.startsWith('/a-propos')) return 'about'
  if (pathname.startsWith('/donnees')) return 'data'
  // Unknown address (page not found, broken link): grouped, never kept.
  return 'other'
}
