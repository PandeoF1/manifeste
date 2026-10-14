/**
 * Judge questions, versioned. French on purpose (see prompts/extract.ts). Answer keys of the
 * natures and levels are the French ones the model was measured with; the judge maps them.
 */
export const JUDGE_QUESTIONS_VERSION = 'v1'

export const WIRE_JUDGE_NATURES = {
  blocage: "des élèves ou étudiants empêchent ou gênent l'entrée (barrage, blocus, poubelles)",
  ferme: 'établissement fermé ou en cours à distance, sans élèves qui bloquent',
  rassemblement: 'élèves rassemblés ou manifestant devant ou en ville, sans gêner ni fermer',
  incident: 'incident (tirs de mortiers, incendie, agression, dégradations) sans blocage dit',
  autre:
    'récit passé, aperçu de ce qui pourrait se passer, opinion, ou pas de fait sur cet établissement',
} as const

export const WIRE_JUDGE_LEVELS = {
  lycee: "lycée, lycée professionnel, collège ou autre établissement d'enseignement secondaire",
  superieur: 'université, fac, IUT, école supérieure, Sciences Po ou campus',
  inconnu: "le texte ne permet pas de savoir si c'est un lycée ou une fac",
} as const

export type WireJudgeStatus = 'bloque' | 'filtrant' | 'leve'

/** The yes/no question, worded for the status the extraction gave. */
export function blockedQuestion(who: string, status: WireJudgeStatus): string {
  if (status === 'leve')
    return (
      `À la date de publication de l'article, le texte dit-il que le blocage ou la fermeture de ${who} est terminé ` +
      `(blocus levé ou terminé, élèves ou étudiants repris les cours, établissement rouvert ou qui rouvre) ? ` +
      `Réponds non s'il n'en est pas question pour cet établissement.`
    )
  if (status === 'filtrant')
    return (
      `À la date de publication de l'article, le texte dit-il que des élèves ou des étudiants font un barrage filtrant ` +
      `ou bloquent en partie l'entrée de ${who}, ou que cet établissement est bloqué ou fermé à cause de la mobilisation ? ` +
      `Réponds non s'il s'agit seulement d'un rassemblement, d'un incident, d'un récit passé, d'un aperçu ou d'une opinion.`
    )
  return (
    `À la date de publication de l'article, le texte dit-il que ${who} est bloqué par des élèves ou des étudiants, ` +
    `ou fermé ou passé à distance à cause de la mobilisation (y compris une fermeture décidée par la préfecture, le rectorat ou la direction à cause des tensions) ? Réponds non s'il s'agit seulement d'un rassemblement, ` +
    `d'un incident, d'un récit passé, d'un aperçu de ce qui pourrait arriver ou d'une opinion.`
  )
}

export const natureQuestion = (who: string) => `Que dit le texte de ${who} ?`
export const levelQuestion = (who: string) =>
  `${who} est-il un lycée ou un établissement d'enseignement supérieur ?`

/** System prompt for the LLM judge, which answers the three questions in one JSON. */
export const LLM_JUDGE_SYSTEM = `Tu relis un extrait d'article de presse français et tu réponds à trois questions sur un établissement scolaire précis cité par l'article.

- probability : probabilité (entre 0 et 1) que la réponse à la première question soit oui, d'après le texte uniquement.
- nature : la clé qui décrit le mieux ce que dit le texte de l'établissement.
- level : la clé qui dit s'il s'agit d'un lycée ou d'un établissement d'enseignement supérieur.
Ne devine rien au-delà du texte fourni. Réponds uniquement avec le JSON demandé.`
