import { z } from 'zod'
import { repairMojibake } from './text.ts'
import { REPORT_STATUSES, type ReportStatus } from './status.ts'
import type { ScrapedItem } from './fetchers/types.ts'

export const CERTAINTIES = ['haute', 'moyenne', 'faible'] as const
export type Certainty = (typeof CERTAINTIES)[number]

/**
 * Filtre lexical avant l'appel IA, pour ne pas payer l'extraction sur du hors-sujet.
 *
 * Deux règles, l'une OU l'autre :
 * - l'ancien filtre, conservé tel quel : aucun élément gardé jusqu'ici n'est perdu ;
 * - un mot d'établissement (lycéens, cité scolaire, fac, campus, Sciences Po…) ET un mot de
 *   blocage (blocage, fermé, occupé, évacué…). L'ancien filtre ratait « blocage » et « lycéens »,
 *   donc « Le blocage de la cité scolaire de Saint-Nazaire » ou « Blocage de Sciences Po ».
 * Le texte est comparé sans accents ni majuscules.
 */
const LEGACY_KEYWORDS =
  /\b(lycees?|lp|lgt|lpo|blocus|bloquee?s?|bloquent|barrage|filtrant|piquet|mobilisation (lyceenne|etudiante))\b/
const SCHOOL_WORDS =
  /\b(lyceen(ne)?s?|lycees?|lp|lgt|lpo|fac|facultes?|universit\w*|campus|iut|sciences po|etudiant\w*|cite scolaire|inspe)\b/
const BLOCKING_WORDS =
  /(blocus|bloqu|blocage|barrage|filtrant|piquet|mobilis|occup|greve|ferme|evacu|manifest|sit-in|rassemblement|incendie|banderole|barricade)/

const plain = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

export function isRelevant(text: string): boolean {
  const t = plain(text)
  return LEGACY_KEYWORDS.test(t) || (SCHOOL_WORDS.test(t) && BLOCKING_WORDS.test(t))
}

/** Événement tel que renvoyé par le modèle, validé strictement. */
export const extractedEventSchema = z.object({
  item_id: z.string(),
  school_name: z.string().trim().min(3).max(200),
  city: z.string().trim().max(120).nullable(),
  status: z.enum(REPORT_STATUSES),
  observed_at: z.string().nullable(),
  certainty: z.enum(CERTAINTIES),
})
export type ExtractedEvent = z.infer<typeof extractedEventSchema>

export const extractionResultSchema = z.object({
  events: z.array(z.unknown()),
})

/** Schéma de sortie structurée transmis à Gemini (sous-ensemble OpenAPI). */
export const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    events: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          item_id: { type: 'STRING', description: "Identifiant de l'élément source (champ id)." },
          school_name: {
            type: 'STRING',
            description: 'Nom du lycée tel que cité, sans la ville. Ex. "Lycée Victor-Hugo".',
          },
          city: { type: 'STRING', nullable: true, description: 'Commune du lycée si connue.' },
          status: { type: 'STRING', enum: [...REPORT_STATUSES] },
          observed_at: {
            type: 'STRING',
            nullable: true,
            description: 'Date et heure du fait, ISO 8601 avec fuseau, null si inconnue.',
          },
          certainty: { type: 'STRING', enum: [...CERTAINTIES] },
        },
        required: ['item_id', 'school_name', 'city', 'status', 'observed_at', 'certainty'],
        propertyOrdering: ['item_id', 'school_name', 'city', 'status', 'observed_at', 'certainty'],
      },
    },
  },
  required: ['events'],
} as const

export const SYSTEM_PROMPT = `Tu extrais des faits sur des blocages de lycées et d'établissements d'enseignement supérieur (facs, universités, IUT, écoles) français à partir de messages publics (presse, canaux Telegram, Bluesky).

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

/**
 * Règle supplémentaire (variante « stricte », désactivée par défaut : GEMINI_STRICT_PROMPT=1) pour
 * les erreurs les plus fréquentes relevées par l'audit manuel : un incident, une manifestation ou
 * un récit pris pour un blocage. À activer seulement après `npm run eval:prompt`.
 */
export const STRICT_RULE =
  '- Un établissement cité seulement pour un incident (agression, incendie, tirs de mortiers, dégradations, coût des travaux), pour une manifestation de rue, ou dans un bilan ou un récit d\'événements passés, sans que le texte dise que son entrée est bloquée ou qu\'il est fermé à cette date : certainty "faible".'

/** Prompt système, avec ou sans la règle stricte (insérée après la règle sur les appels au blocus). */
export function systemPrompt(strict = false): string {
  if (!strict) return SYSTEM_PROMPT
  const anchor = '- Un appel ou un projet de blocus n\'est pas un blocage : certainty "faible".\n'
  return SYSTEM_PROMPT.includes(anchor)
    ? SYSTEM_PROMPT.replace(anchor, `${anchor}${STRICT_RULE}\n`)
    : SYSTEM_PROMPT
}

/** Longueur maximale du texte envoyé par élément (jamais atteinte en pratique : max observé ≈ 4 500). */
export const DEFAULT_TEXT_CHARS = 6000

export function buildUserPrompt(
  items: ReadonlyArray<{ id: string; item: ScrapedItem }>,
  textChars: number = DEFAULT_TEXT_CHARS,
): string {
  const payload = items.map(({ id, item }) => ({
    id,
    publie_le: item.publishedAt.toISOString(),
    texte: item.text.slice(0, textChars),
  }))
  return `Messages à analyser (JSON) :\n${JSON.stringify(payload)}`
}

/** Valide la sortie du modèle et ignore silencieusement les événements mal formés. */
export function parseExtraction(raw: unknown, knownIds: ReadonlySet<string>): ExtractedEvent[] {
  const result = extractionResultSchema.safeParse(raw)
  if (!result.success) return []
  const events: ExtractedEvent[] = []
  for (const candidate of result.data.events) {
    const parsed = extractedEventSchema.safeParse(candidate)
    if (parsed.success && knownIds.has(parsed.data.item_id)) {
      // Filet de sécurité : l'IA recopie parfois un texte mal encodé (« LunÃ©ville »).
      events.push({
        ...parsed.data,
        school_name: repairMojibake(parsed.data.school_name),
        city: parsed.data.city === null ? null : repairMojibake(parsed.data.city),
      })
    }
  }
  return events
}

const CERTAINTY_RANK: Record<Certainty, number> = { faible: 0, moyenne: 1, haute: 2 }

export function meetsCertainty(value: Certainty, min: Certainty): boolean {
  return CERTAINTY_RANK[value] >= CERTAINTY_RANK[min]
}

/** Jour civil à Paris (AAAA-MM-JJ) : sert à reconnaître un fait annoncé pour un autre jour. */
function parisDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(d)
}

/** Décalage de Paris par rapport à UTC à cette date (« +02:00 » l'été, « +01:00 » l'hiver). */
function parisOffset(at: Date): string {
  const label =
    new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+01:00'
  return label === 'GMT' ? '+00:00' : label.replace('GMT', '')
}

/** Heure retenue quand l'IA ne donne que le jour : début des cours, à Paris. */
const MORNING = '08:00:00'

/** Le jour (AAAA-MM-JJ) si l'IA n'a donné qu'une date ou minuit, sinon null. */
function dayOnly(extracted: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})(?:T00:00(?::00(?:\.0+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(
    extracted.trim(),
  )
  return m?.[1] ?? null
}

/** 8 h à Paris ce jour-là. */
function morningOf(day: string): Date {
  return new Date(`${day}T${MORNING}${parisOffset(new Date(`${day}T12:00:00Z`))}`)
}

/** Un fait annoncé reste daté du jour annoncé jusqu'à 3 jours après la publication. */
const ANNOUNCED_MAX_MS = 3 * 86_400_000

/** D'où vient la date retenue pour un fait. */
export type DateBasis = 'extracted' | 'announced' | 'published'

/**
 * Date du fait retenue : celle extraite si plausible, sinon la date de publication.
 * Plausible = pas après la publication (+1 h de marge) et au plus 7 jours avant. Exception : un
 * fait annoncé pour un jour à venir (« fermés ce lundi », article publié le dimanche) garde le
 * jour annoncé, dans les 3 jours. Il n'apparaît sur la carte que ce jour-là.
 */
export function resolveObservation(
  extracted: string | null,
  publishedAt: Date,
): { at: Date; basis: DateBasis } {
  const fallback = { at: publishedAt, basis: 'published' as const }
  if (!extracted) return fallback
  const d = new Date(extracted)
  if (Number.isNaN(d.getTime())) return fallback

  // Jour seul (« 2026-10-05 ») ou minuit : sans heure, un fait daté de minuit UTC tombe à 2 h à
  // Paris et sort de la carte (cinq heures de validité) avant le début des cours.
  const day = dayOnly(extracted)
  if (day) {
    const morning = morningOf(day)
    const pubDay = parisDay(publishedAt)
    if (day > pubDay) {
      const ahead = morning.getTime() - publishedAt.getTime() <= ANNOUNCED_MAX_MS
      return ahead ? { at: morning, basis: 'announced' } : fallback
    }
    if (day === pubDay)
      return { at: morning < publishedAt ? morning : publishedAt, basis: 'extracted' }
    return morning.getTime() - publishedAt.getTime() < -7 * 86_400_000
      ? fallback
      : { at: morning, basis: 'extracted' }
  }

  const delta = d.getTime() - publishedAt.getTime()
  if (delta < -7 * 86_400_000) return fallback
  if (delta <= 3_600_000) return { at: d, basis: 'extracted' }
  const announced = delta <= ANNOUNCED_MAX_MS && parisDay(d) > parisDay(publishedAt)
  return announced ? { at: d, basis: 'announced' } : fallback
}

export function resolveObservedAt(extracted: string | null, publishedAt: Date): Date {
  return resolveObservation(extracted, publishedAt).at
}

export type { ReportStatus }
