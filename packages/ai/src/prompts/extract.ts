/**
 * Extraction prompts, versioned. The text is French on purpose: it instructs a model about
 * French press and French school vocabulary, and the wording was tuned on the labelled sample.
 * Never edit a version in place: add a new one, benchmark it (`bench/ai`), then switch the config.
 *
 * The wire vocabulary of the answer is French too ("bloque", "haute"…) because the prompt
 * defines it; the task maps it to the English domain values.
 */

const BASE = `Tu extrais des faits sur des blocages de lycées et d'établissements d'enseignement supérieur (facs, universités, IUT, écoles) français à partir de messages publics (presse, canaux Telegram, Bluesky).

Pour chaque établissement explicitement cité comme bloqué, sous barrage filtrant ou débloqué, produis un événement :
- status "bloque" : entrée de l'établissement bloquée (blocus), ou établissement fermé / « porte close » à cause de la mobilisation.
- status "filtrant" : barrage filtrant, entrée partiellement bloquée.
- status "leve" : blocus levé, fin du blocage, établissement rouvert.
- observed_at : moment du fait. Déduis-le du texte et de la date de publication fournie ("ce matin", "hier"). Si le fait est annoncé pour un jour à venir ("fermés ce lundi", "demain"), donne ce jour à venir. Donne l'heure si le texte la dit ; sinon donne seulement le jour (AAAA-MM-JJ). null si impossible.
- certainty : "haute" si le fait est affirmé clairement et au présent ; "moyenne" si probable ; "faible" si appel à bloquer, rumeur, conditionnel, futur ou fait ancien.

Règles strictes :
- Uniquement des lycées et des établissements d'enseignement supérieur (pas de collèges, d'écoles primaires, d'entreprises ni de mairies).
- Un appel ou un projet de blocus n'est pas un blocage : certainty "faible".
- Ne recopie jamais de nom de personne, de pseudo, de chiffre de participants ni de description de la scène.
- school_name : le nom propre de l'établissement tel qu'il apparaît dans le texte (ex. "Lycée Joséphine-Baker", "Université Paris 8", "fac de Tolbiac", "IUT de Tarbes"), même s'il n'est cité qu'une fois. N'utilise le nom de la commune ("lycée de Hanches") que si le texte ne donne aucun autre nom.
- city : la commune de l'établissement (ou du site pour une fac), même si elle n'apparaît que dans le titre.
- Si un message cite plusieurs établissements (par exemple un article qui en dresse la liste), produis un événement par établissement.
- Un texte qui commence par « Carte « … » » est un point d'une carte collaborative des lycées bloqués ou fermés : sauf indication contraire, c'est un établissement bloqué (certainty "moyenne"), daté de la publication.
- Si aucun fait exploitable, ne produis rien pour ce message.
Réponds uniquement avec le JSON demandé.`

const BEFORE_STRICT =
  '- Un appel ou un projet de blocus n\'est pas un blocage : certainty "faible".\n'

/** The most frequent errors of the manual audit: an incident, a street demonstration or a story taken for a blockade. */
const STRICT_RULE =
  '- Un établissement cité seulement pour un incident (agression, incendie, tirs de mortiers, dégradations, coût des travaux), pour une manifestation de rue, ou dans un bilan ou un récit d\'événements passés, sans que le texte dise que son entrée est bloquée ou qu\'il est fermé à cette date : certainty "faible".'

/** Adds what is happening at the school: priority to "blocage" when in doubt. */
const NATURE_RULE = `- nature : ce qui se passe à l'établissement.
  - "blocage" : des élèves ou des étudiants gênent ou empêchent l'entrée (barrage, blocus, poubelles, piquet), même si l'établissement ferme ou passe à distance à cause de ça.
  - "ferme" : l'établissement est fermé ou en cours à distance, sans que le texte dise que des élèves bloquent l'entrée.
  - "rassemblement" : des élèves se rassemblent ou manifestent devant l'établissement ou en ville, sans gêner l'entrée ni fermeture.
  - En cas de doute, choisis "blocage".`

export interface ExtractPrompt {
  version: string
  system: string
  /** Whether the answer carries a `nature` per event. */
  withNature: boolean
}

function withStrict(base: string): string {
  // A prompt that silently loses its strict rule would change what reaches the public without
  // anyone noticing: fail when the module loads instead.
  if (!base.includes(BEFORE_STRICT))
    throw new Error('extract prompt: the line the strict rule goes after was edited or removed')
  return base.replace(BEFORE_STRICT, `${BEFORE_STRICT}${STRICT_RULE}\n`)
}

function withNature(base: string): string {
  const marker = '- certainty :'
  if (base.includes(marker)) return base.replace(marker, `${NATURE_RULE}\n${marker}`)
  if (base.includes('\nRègles strictes :'))
    return base.replace('\nRègles strictes :', `\n${NATURE_RULE}\n\nRègles strictes :`)
  throw new Error('extract prompt: no place found for the nature rule')
}

export const EXTRACT_PROMPTS = {
  /** In production since the first release. */
  v1: { version: 'v1', system: BASE, withNature: false },
  /** v1 plus the incident / street demonstration / story rule. */
  'v1-strict': { version: 'v1-strict', system: withStrict(BASE), withNature: false },
  /** v1 plus a `nature` field. */
  'v1-nature': { version: 'v1-nature', system: withNature(BASE), withNature: true },
  'v1-strict-nature': {
    version: 'v1-strict-nature',
    system: withNature(withStrict(BASE)),
    withNature: true,
  },
} as const satisfies Record<string, ExtractPrompt>

export type ExtractPromptVersion = keyof typeof EXTRACT_PROMPTS
export const EXTRACT_PROMPT_VERSIONS = Object.keys(EXTRACT_PROMPTS) as ExtractPromptVersion[]
