// Banc d'essai d'un « juge » (second avis sur chaque signalement candidat) : fonctions pures,
// testées dans tests/eval-judge.test.ts. Le juge répond à « cet article dit-il que cet
// établissement est bloqué ou fermé à cette date ? » avec une probabilité ; on cherche le seuil
// qui écarte des faux sans perdre de vrais, sur les signalements jugés à la main.

import { sentencesAbout } from './audit-reports-lib.ts'

export interface JudgedOutcome {
  /** Verdict de l'audit manuel : le signalement est-il vrai ? */
  label: 'oui' | 'non'
  /** Probabilité (0 à 1) donnée par le juge que le fait est vrai ; null si pas de réponse. */
  probability: number | null
}

export interface SweepRow {
  threshold: number
  /** Vrais gardés (probabilité ≥ seuil) sur le total des vrais. */
  trueKept: number
  trueTotal: number
  /** Faux écartés (probabilité < seuil) sur le total des faux. */
  falseRemoved: number
  falseTotal: number
}

/** Pour chaque seuil : combien de vrais on garde et combien de faux on écarte. */
export function sweep(
  outcomes: ReadonlyArray<JudgedOutcome>,
  thresholds: ReadonlyArray<number> = [0.5, 0.6, 0.7, 0.8, 0.9],
): SweepRow[] {
  const answered = outcomes.filter((o) => o.probability !== null)
  const vrais = answered.filter((o) => o.label === 'oui')
  const faux = answered.filter((o) => o.label === 'non')
  return thresholds.map((threshold) => ({
    threshold,
    trueKept: vrais.filter((o) => (o.probability as number) >= threshold).length,
    trueTotal: vrais.length,
    falseRemoved: faux.filter((o) => (o.probability as number) < threshold).length,
    falseTotal: faux.length,
  }))
}

/**
 * Seuil recommandé : le plus haut qui garde au moins `minKept` (95 % par défaut) des vrais.
 * undefined si aucun seuil ne tient, c'est-à-dire que le juge ne vaut pas la peine.
 */
export function bestThreshold(rows: ReadonlyArray<SweepRow>, minKept = 0.95): SweepRow | undefined {
  return [...rows]
    .filter((r) => r.trueTotal > 0 && r.trueKept / r.trueTotal >= minKept)
    .sort((a, b) => b.threshold - a.threshold)[0]
}

/** Estimation du coût d'un lot : tokens d'entrée estimés (≈ 1 token pour 3,5 caractères en français). */
export function estimateTokens(texts: ReadonlyArray<string>): number {
  return Math.ceil(texts.reduce((n, t) => n + t.length, 0) / 3.5)
}

// --- Jev (TypeSafe AI) : POST https://api.typesafe.ai/v1/systemone ---------------------------------

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

// --- Comparaison par groupes (Gemini seul, puis Gemini + juge) --------------------------------------

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

export type GroupBy = 'domain' | 'day' | 'status' | 'level' | 'certainty'

export interface ReportRow {
  id: string
  day: string
  domain: string
  status: string
  level: string
  certainty: string | null
  probability: number | null
  nature: string | null
  /** Niveau annoncé par le juge avec assez de certitude, s'il contredit la base. */
  levelConflict: boolean
}

export function groupKey(r: ReportRow, by: GroupBy): string {
  return by === 'domain'
    ? r.domain
    : by === 'day'
      ? r.day
      : by === 'status'
        ? r.status
        : by === 'level'
          ? r.level
          : (r.certainty ?? 'sans')
}

export type Zone = 'garde' | 'incertain' | 'retire' | 'non-juge'

/** garde ≥ seuil ; incertain entre le seuil bas et le seuil ; retiré en dessous ; non-juge sans réponse. */
export function zoneOf(r: ReportRow, keep = 0.5, low = 0.3): Zone {
  if (r.levelConflict) return 'retire'
  if (r.probability === null) return 'non-juge'
  return r.probability >= keep ? 'garde' : r.probability >= low ? 'incertain' : 'retire'
}

export interface GroupSummary {
  group: string
  n: number
  garde: number
  incertain: number
  retire: number
  nonJuge: number
  natures: Record<string, number>
}

export function summarizeGroups(
  rows: ReadonlyArray<ReportRow>,
  by: GroupBy,
  keep = 0.5,
  low = 0.3,
): GroupSummary[] {
  const map = new Map<string, GroupSummary>()
  for (const r of rows) {
    const key = groupKey(r, by)
    const g = map.get(key) ?? {
      group: key,
      n: 0,
      garde: 0,
      incertain: 0,
      retire: 0,
      nonJuge: 0,
      natures: {},
    }
    g.n++
    const z = zoneOf(r, keep, low)
    if (z === 'garde') g.garde++
    else if (z === 'incertain') g.incertain++
    else if (z === 'retire') g.retire++
    else g.nonJuge++
    if (r.nature) g.natures[r.nature] = (g.natures[r.nature] ?? 0) + 1
    map.set(key, g)
  }
  return [...map.values()].sort((a, b) => b.n - a.n)
}

/** Le juge est sûr (≥ 0,8) d'un niveau qui contredit celui de la base (hors « inconnu »). */
export function conflictsWithBase(
  schoolLevel: string,
  answer: Pick<JudgeAnswer, 'level' | 'levelProbabilities'>,
): boolean {
  const level = answer.level
  if (!level || level === 'inconnu') return false
  return level !== schoolLevel && (answer.levelProbabilities?.[level] ?? 0) >= 0.8
}

// --- Rapport par niveaux (ce que montrerait le site avec le juge) -----------------------------------

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
    return r.nature === 'blocage' || r.nature === 'ferme' ? 'confirme' : 'mobilise'
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
