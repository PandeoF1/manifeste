/**
 * Overseas: territories shown as insets on the national map view, when at least
 * one school there has a signal. Metropolitan France fills the whole frame; without an inset, these points
 * would be out of view (or tiny and lost in the ocean).
 */

/** [west, south, east, north] */
export type Bbox = [number, number, number, number]

export interface Territory {
  id: string
  label: string
  /** Department codes (`department` field) belonging to the territory. */
  departments: readonly string[]
  /** Base framing of the inset. */
  bbox: Bbox
}

export const TERRITORIES: readonly Territory[] = [
  {
    id: 'guadeloupe',
    label: 'Guadeloupe',
    departments: ['971'],
    bbox: [-61.95, 15.8, -60.95, 16.55],
  },
  {
    id: 'martinique',
    label: 'Martinique',
    departments: ['972'],
    bbox: [-61.3, 14.35, -60.75, 14.95],
  },
  { id: 'guyane', label: 'Guyane', departments: ['973'], bbox: [-54.7, 2.1, -51.6, 5.8] },
  { id: 'reunion', label: 'La Réunion', departments: ['974'], bbox: [55.15, -21.45, 55.9, -20.85] },
  { id: 'mayotte', label: 'Mayotte', departments: ['976'], bbox: [44.95, -13.1, 45.35, -12.55] },
  {
    id: 'saint-martin',
    label: 'Saint-Martin et Saint-Barthélemy',
    departments: ['977', '978'],
    bbox: [-63.2, 17.8, -62.75, 18.2],
  },
  {
    id: 'spm',
    label: 'Saint-Pierre-et-Miquelon',
    departments: ['975'],
    bbox: [-56.5, 46.7, -56.1, 47.15],
  },
  {
    id: 'nouvelle-caledonie',
    label: 'Nouvelle-Calédonie',
    departments: ['988'],
    bbox: [163.5, -22.8, 167.6, -19.5],
  },
  {
    id: 'polynesie',
    label: 'Polynésie française',
    departments: ['987'],
    bbox: [-149.9, -18.0, -149.0, -17.3],
  },
  {
    id: 'wallis-futuna',
    label: 'Wallis-et-Futuna',
    departments: ['986'],
    bbox: [-178.3, -14.4, -176.0, -13.1],
  },
]

const BY_DEPARTMENT = new Map(TERRITORIES.flatMap((t) => t.departments.map((d) => [d, t] as const)))

export function territoryOf(department: string | null | undefined): Territory | undefined {
  return department ? BY_DEPARTMENT.get(department) : undefined
}

interface Located {
  department: string | null
  lat: number
  lng: number
}

export interface ActiveTerritory {
  territory: Territory
  count: number
  /** Framing: the territory's, widened to points outside it (remote islands). */
  bounds: Bbox
}

/** Territories with at least one point, in display order (the busiest first). */
export function activeTerritories(points: ReadonlyArray<Located>): ActiveTerritory[] {
  const found = new Map<string, ActiveTerritory>()
  for (const p of points) {
    const territory = territoryOf(p.department)
    if (!territory) continue
    let entry = found.get(territory.id)
    if (!entry) {
      entry = { territory, count: 0, bounds: [...territory.bbox] }
      found.set(territory.id, entry)
    }
    entry.count += 1
    const b = entry.bounds
    b[0] = Math.min(b[0], p.lng - 0.05)
    b[1] = Math.min(b[1], p.lat - 0.05)
    b[2] = Math.max(b[2], p.lng + 0.05)
    b[3] = Math.max(b[3], p.lat + 0.05)
  }
  return [...found.values()].sort(
    (a, b) => b.count - a.count || a.territory.label.localeCompare(b.territory.label, 'fr'),
  )
}

/** National view: zoomed out enough for all of metropolitan France to fit on screen. */
export const NATIONAL_MAX_ZOOM = 7
