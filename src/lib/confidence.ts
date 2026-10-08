/**
 * Nombre de sources distinctes derrière un signalement. C'est une information, pas un label de
 * qualité : l'audit manuel de 200 signalements n'a montré aucun gain d'exactitude entre une
 * source unique et plusieurs sources (les articles reprennent souvent la même erreur : un
 * incident ou un rassemblement lu comme un blocage). On affiche donc le nombre, sans écrire
 * « confirmé ».
 */
export type SourceCountLevel = 'plusieurs' | 'unique' | 'inconnu'

export interface SourceCount {
  level: SourceCountLevel
  /** Texte court (badge). */
  label: string
  /** Explication (infobulle). */
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
