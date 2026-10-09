// Juge Jev (TypeSafe AI) : second avis sur un signalement. On lui donne le titre et les phrases de l'article
// qui parlent de l'établissement, il répond par une probabilité que le fait soit vrai, une nature et un
// niveau (lycée ou fac). Il ne décide rien tout seul : la collecte enregistre sa réponse.
// POST https://api.typesafe.ai/v1/systemone. Modèle fixé : « jev-latest » peut changer sans prévenir.
import { sentencesAbout } from './school-text.ts'
import type { FetchLike } from './fetchers/types.ts'

export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
export const JEV_MODEL = 'jev-1.13.0'

/** Natures proposées au juge (la question « nature » donne la répartition, pas la décision). */
export const JUDGE_NATURES = {
  blocage: "des élèves ou étudiants empêchent ou gênent l'entrée (barrage, blocus, poubelles)",
  ferme: 'établissement fermé ou en cours à distance, sans élèves qui bloquent',
  rassemblement: 'élèves rassemblés ou manifestant devant ou en ville, sans gêner ni fermer',
  incident: 'incident (tirs de mortiers, incendie, agression, dégradations) sans blocage dit',
  autre:
    'récit passé, aperçu de ce qui pourrait se passer, opinion, ou pas de fait sur cet établissement',
} as const
export type JudgeNature = keyof typeof JUDGE_NATURES

/** Niveaux proposés au juge (pour recouper avec le niveau de l'établissement en base). */
export const JUDGE_LEVELS = {
  lycee: "lycée, lycée professionnel, collège ou autre établissement d'enseignement secondaire",
  superieur: 'université, fac, IUT, école supérieure, Sciences Po ou campus',
  inconnu: "le texte ne permet pas de savoir si c'est un lycée ou une fac",
} as const
export type JudgeLevel = keyof typeof JUDGE_LEVELS

export interface JevQuestion {
  type: 'noul' | 'choice'
  instructions: string
  criteria?: Record<string, string>
}

/** Questions posées pour un établissement cité dans un article, selon le statut publié par Gemini. */
export function buildQuestions(
  school: { name: string; city: string },
  status: 'bloque' | 'filtrant' | 'leve' = 'bloque',
): Record<string, JevQuestion> {
  const who = `« ${school.name} » (${school.city})`
  return {
    bloque: {
      type: 'noul',
      instructions:
        status === 'leve'
          ? `À la date de publication de l'article, le texte dit-il que le blocage ou la fermeture de ${who} est terminé ` +
            `(blocus levé, élèves repris les cours, établissement rouvert) ? Réponds non s'il n'en est pas question pour cet établissement.`
          : `À la date de publication de l'article, le texte dit-il que ${who} est bloqué par des élèves ou des étudiants, ` +
            `ou fermé ou passé à distance à cause de la mobilisation (y compris une fermeture décidée par la préfecture, le rectorat ou la direction à cause des tensions) ? Réponds non s'il s'agit seulement d'un rassemblement, ` +
            `d'un incident, d'un récit passé, d'un aperçu de ce qui pourrait arriver ou d'une opinion.`,
    },
    nature: {
      type: 'choice',
      instructions: `Que dit le texte de ${who} ?`,
      criteria: { ...JUDGE_NATURES },
    },
    level: {
      type: 'choice',
      instructions: `${who} est-il un lycée ou un établissement d'enseignement supérieur ?`,
      criteria: { ...JUDGE_LEVELS },
    },
  }
}

export interface JudgeAnswer {
  /** Probabilité que le fait soit vrai (question « bloque »). */
  probability: number | null
  nature: JudgeNature | null
  natureProbabilities: Record<string, number>
  level?: JudgeLevel | null
  levelProbabilities?: Record<string, number>
}

/** Lit la réponse de /v1/systemone ; tolère les champs manquants (null). */
export function parseJevResponse(raw: unknown): JudgeAnswer {
  const answers = (raw as { answers?: Record<string, Record<string, unknown>> } | null)?.answers
  const noul = answers?.bloque?.noul
  const choice = answers?.nature?.choice
  const probs = answers?.nature?.probabilities
  const level = answers?.level?.choice
  const levelProbs = answers?.level?.probabilities
  const numbers = (o: unknown): Record<string, number> =>
    o && typeof o === 'object'
      ? Object.fromEntries(
          Object.entries(o as Record<string, unknown>).filter(
            (e): e is [string, number] => typeof e[1] === 'number',
          ),
        )
      : {}
  return {
    probability: typeof noul === 'number' && noul >= 0 && noul <= 1 ? noul : null,
    nature: typeof choice === 'string' && choice in JUDGE_NATURES ? (choice as JudgeNature) : null,
    natureProbabilities: numbers(probs),
    level: typeof level === 'string' && level in JUDGE_LEVELS ? (level as JudgeLevel) : null,
    levelProbabilities: numbers(levelProbs),
  }
}

/** Prix annoncé par TypeSafe : 42 $ le milliard de tokens en entrée, sortie gratuite. */
export const JEV_USD_PER_INPUT_TOKEN = 42 / 1_000_000_000

/**
 * Texte envoyé au juge : le titre et les phrases qui parlent de l'établissement, pas tout l'article
 * (la doc de Jev prévient qu'un état plein de détails sans rapport baisse la précision).
 */
export function focusState(
  article: { title: string; text: string },
  school: { name: string; city: string },
  publishedDay: string,
  maxChars = 2000,
): string {
  const sentences = sentencesAbout(article.text, school)
  const body = (sentences.length ? sentences.join('\n') : article.text.slice(0, 1200)).slice(
    0,
    maxChars,
  )
  return `Article publié le ${publishedDay}\nTitre : ${article.title}\n\n${body}`
}

export interface JudgeInput {
  school: { name: string; city: string }
  status: 'bloque' | 'filtrant' | 'leve'
  title?: string
  text: string
  /** Jour de publication (AAAA-MM-JJ, heure de Paris). */
  publishedDay: string
}

/** Texte trop court pour juger : on ne demande rien (le juge n'a pas été mesuré sur des titres seuls). */
export const MIN_JUDGE_CHARS = 300

export type Judge = (
  input: JudgeInput,
) => Promise<(JudgeAnswer & { model: string; chars: number }) | null>

export function createJevJudge(opts: {
  apiKey: string
  fetchFn?: FetchLike
  model?: string
  timeoutMs?: number
}): Judge {
  const fetchFn = opts.fetchFn ?? fetch
  const model = opts.model ?? JEV_MODEL
  return async (input) => {
    if (input.text.length < MIN_JUDGE_CHARS) return null
    const state = focusState(
      { title: input.title ?? '', text: input.text },
      input.school,
      input.publishedDay,
    )
    try {
      const res = await fetchFn(JEV_ENDPOINT, {
        method: 'POST',
        headers: { authorization: `Bearer ${opts.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          state,
          model,
          questions: buildQuestions(input.school, input.status),
        }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
      })
      if (!res.ok) return null
      const answer = parseJevResponse(await res.json())
      if (answer.probability === null) return null
      return { ...answer, model, chars: state.length }
    } catch {
      return null
    }
  }
}
