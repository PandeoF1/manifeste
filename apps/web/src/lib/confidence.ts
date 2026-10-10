/**
 * Number of distinct sources behind a report. This is information, not a quality
 * label: the manual audit of 200 reports showed no accuracy gain between a single
 * source and several (articles often repeat the same mistake: an
 * incident or a gathering read as a blockade). So we show the count, without writing
 * "confirmed".
 */
export type SourceCountLevel = 'plusieurs' | 'unique' | 'inconnu'

export interface SourceCount {
  level: SourceCountLevel
  /** Short text (badge). */
  label: string
  /** Explanation (tooltip). */
  detail: string
}

export function sourceCount(count: number | null | undefined): SourceCount {
  const n = Math.max(0, Math.floor(count ?? 0))
  if (n >= 2) {
    return {
      level: 'plusieurs',
      label: `${n} sources`,
      detail: `${n} sources distinctes (articles ou messages) rapportent ce signalement. Cela ne prouve pas à lui seul que l’établissement est bloqué : lis les sources.`,
    }
  }
  if (n === 1) {
    return {
      level: 'unique',
      label: '1 source',
      detail: 'Un seul article ou message rapporte ce signalement : il n’est pas recoupé.',
    }
  }
  return { level: 'inconnu', label: 'Source inconnue', detail: 'Aucune source associée.' }
}
