// Répartition des sources d'un passage entre les sous-appels de lecture.

export interface PlannedSource {
  id: string
  label: string
  identifier: string
}

export const isGoogleNewsSearch = (identifier: string) =>
  identifier.startsWith('https://news.google.com/rss/')

/**
 * Groupes de `perGroup` sources. Au plus `maxGoogleNews` recherches Google Actualités (les
 * premières, donc les plus anciennes), une par groupe, pour étaler les appels à Google.
 */
export function planGroups<T extends PlannedSource>(
  sources: T[],
  perGroup: number,
  maxGoogleNews: number,
): T[][] {
  const google = sources.filter((s) => isGoogleNewsSearch(s.identifier)).slice(0, maxGoogleNews)
  const others = sources.filter((s) => !isGoogleNewsSearch(s.identifier))
  const groups: T[][] = []
  for (let i = 0; i < others.length; i += perGroup) groups.push(others.slice(i, i + perGroup))
  google.forEach((g, i) => {
    // Une recherche Google par groupe, en tête : la plus lente part la première.
    if (i < groups.length) (groups[i] as T[]).unshift(g)
    else groups.push([g])
  })
  return groups
}
