/**
 * Confiance dans un signalement, selon le nombre de sources distinctes qui le rapportent. Un
 * établissement cité par deux articles ou messages différents est bien plus sûr qu'un signalement
 * isolé : on l'affiche, sans jamais prétendre l'avoir vérifié sur place.
 */
export type SourceConfidenceLevel = 'confirme' | 'unique' | 'inconnu'

export interface SourceConfidence {
  level: SourceConfidenceLevel
  /** Texte court (badge). */
  label: string
  /** Explication (infobulle). */
  detail: string
}

export function sourceConfidence(sourceCount: number | null | undefined): SourceConfidence {
  const n = Math.max(0, Math.floor(sourceCount ?? 0))
  if (n >= 2) {
    return {
      level: 'confirme',
      label: `Confirmé par ${n} sources`,
      detail: `${n} sources distinctes (articles ou messages) rapportent ce signalement.`,
    }
  }
  if (n === 1) {
    return {
      level: 'unique',
      label: 'Source unique',
      detail: 'Un seul article ou message rapporte ce signalement : il n’est pas recoupé.',
    }
  }
  return { level: 'inconnu', label: 'Source inconnue', detail: 'Aucune source associée.' }
}

/** Minimum de sources pour parler d'un signalement « confirmé ». */
export const CONFIRMED_MIN_SOURCES = 2
