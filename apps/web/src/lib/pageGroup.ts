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

/** Type de page envoyé aux statistiques : jamais l'adresse exacte (ni le lycée consulté). */
export function pageGroup(pathname: string): PageGroup | null {
  // Pages intégrées sur d'autres sites : ni visites ni « en ligne » (elles fausseraient les stats).
  if (pathname.startsWith('/admin') || pathname.startsWith('/embed')) return null
  if (pathname === '/' || pathname === '') return 'carte'
  if (pathname.startsWith('/liste')) return 'liste'
  if (pathname.startsWith('/lycee/')) return 'lycee'
  if (pathname.startsWith('/signaler')) return 'signaler'
  if (pathname.startsWith('/a-propos')) return 'a-propos'
  if (pathname.startsWith('/donnees')) return 'donnees'
  // Adresse inconnue (page introuvable, lien erroné) : regroupée, jamais conservée.
  return 'autre'
}
