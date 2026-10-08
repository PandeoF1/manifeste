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
- observed_at : moment du fait. Déduis-le du texte et de la date de publication fournie ("ce matin", "hier"). null si impossible.
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

export function buildUserPrompt(items: ReadonlyArray<{ id: string; item: ScrapedItem }>): string {
  const payload = items.map(({ id, item }) => ({
    id,
    publie_le: item.publishedAt.toISOString(),
    texte: item.text.slice(0, 6000),
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

/**
 * Date du fait retenue : celle extraite si plausible, sinon la date de publication.
 * Plausible = pas après la publication (+1 h de marge) et au plus 7 jours avant.
 */
export function resolveObservedAt(extracted: string | null, publishedAt: Date): Date {
  if (!extracted) return publishedAt
  const d = new Date(extracted)
  if (Number.isNaN(d.getTime())) return publishedAt
  const delta = d.getTime() - publishedAt.getTime()
  if (delta > 3_600_000 || delta < -7 * 86_400_000) return publishedAt
  return d
}

export type { ReportStatus }
