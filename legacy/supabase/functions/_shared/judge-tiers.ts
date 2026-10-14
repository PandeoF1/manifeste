// Niveaux de confiance d'un signalement d'après l'avis du juge, et chiffres qui en découlent.
// Partagé par le rapport (scripts/compare-judge.ts) et la page « Juge » de l'admin.

/**
 * confirme : le texte dit que l'établissement est bloqué ou fermé (probabilité ≥ seuil, nature blocage
 *   ou fermé) ; un signalement fait sur place compte aussi.
 * mobilise : il y a bien quelque chose (rassemblement, incident, cas pas clair) mais le texte ne dit
 *   pas que l'entrée est bloquée ou que l'établissement est fermé.
 * non-retenu : récit, aperçu, tribune, mauvais établissement : gardé en base, jamais compté.
 * non-juge : article illisible, le juge n'a rien dit (compté comme aujourd'hui).
 */
export type Tier = 'confirme' | 'mobilise' | 'non-retenu' | 'non-juge'

export function tierOf(
  r: {
    probability: number | null
    nature: string | null
    /** Statut publié : pour un « levé », le score seul suffit (la nature décrit le blocage passé). */
    status?: string
    levelConflict?: boolean
    userReport?: boolean
  },
  keep = 0.5,
  low = 0.3,
): Tier {
  if (r.userReport) return 'confirme'
  if (r.probability === null) return 'non-juge'
  if (r.levelConflict) return 'non-retenu'
  if (r.probability >= keep)
    return r.status === 'leve' || r.nature === 'blocage' || r.nature === 'ferme'
      ? 'confirme'
      : 'mobilise'
  if (r.probability >= low) return 'mobilise'
  return r.nature === 'rassemblement' || r.nature === 'incident' ? 'mobilise' : 'non-retenu'
}

export interface RapportRow {
  uai: string
  department: string
  level: string
  status: string
  observedAt: string
  domain: string | null
  tier: Tier
  nature: string | null
}

export interface Chiffres {
  etablissements: number
  pic: { jour: string; n: number }
  departements: number
  facs: number
  sources: number
  maintenant: { total: number; bloques: number }
  /** Parmi les établissements (nature du signalement le plus net). */
  natures: Record<string, number>
}

const parisDayOf = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(iso))

/**
 * Les chiffres de la page Données pour un ensemble de niveaux : établissements bloqués ou en barrage
 * filtrant (hors « levé »), meilleure journée, départements, facs, sites, et « en ce moment »
 * (dernier signalement de moins de `ttlHours` par établissement).
 */
export function chiffres(
  rows: ReadonlyArray<RapportRow>,
  tiers: ReadonlyArray<Tier>,
  now: Date,
  ttlHours = 5,
): Chiffres {
  const kept = rows.filter((r) => tiers.includes(r.tier) && new Date(r.observedAt) <= now)
  const actifs = kept.filter((r) => r.status === 'bloque' || r.status === 'filtrant')
  const byDay = new Map<string, Set<string>>()
  for (const r of actifs) {
    const d = parisDayOf(r.observedAt)
    byDay.set(d, (byDay.get(d) ?? new Set()).add(r.uai))
  }
  const peak = [...byDay.entries()].sort((a, b) => b[1].size - a[1].size)[0]
  const live = new Map<string, RapportRow>()
  for (const r of kept) {
    if (now.getTime() - new Date(r.observedAt).getTime() > ttlHours * 3_600_000) continue
    const cur = live.get(r.uai)
    if (!cur || r.observedAt > cur.observedAt) live.set(r.uai, r)
  }
  const now_ = [...live.values()].filter((r) => r.status === 'bloque' || r.status === 'filtrant')
  const natures: Record<string, number> = {}
  const best = new Map<string, string>()
  for (const r of actifs) {
    const n = r.nature ?? 'non jugé'
    const cur = best.get(r.uai)
    const rank = (x: string | undefined) => (x === 'blocage' ? 3 : x === 'ferme' ? 2 : x ? 1 : 0)
    if (rank(n) > rank(cur)) best.set(r.uai, n)
  }
  for (const n of best.values()) natures[n] = (natures[n] ?? 0) + 1
  return {
    etablissements: new Set(actifs.map((r) => r.uai)).size,
    pic: { jour: peak?.[0] ?? '', n: peak?.[1].size ?? 0 },
    departements: new Set(actifs.map((r) => r.department)).size,
    facs: new Set(actifs.filter((r) => r.level === 'superieur').map((r) => r.uai)).size,
    sources: new Set(actifs.map((r) => r.domain).filter(Boolean)).size,
    maintenant: { total: now_.length, bloques: now_.filter((r) => r.status === 'bloque').length },
    natures,
  }
}
