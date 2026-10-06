// Analyse du traitement médiatique (onglet admin « Médias ») : pour chaque article de presse
// collecté, l'IA répond à des questions factuelles (revendications citées ? qui a la parole ?
// angle incidents ou mobilisation ? vocabulaire ?) avec une citation à l'appui. Le texte de
// l'article n'est pas stocké : seulement ces réponses, l'adresse et le titre.
import { z } from 'zod'
import { canonicalUrl, extractDomain } from './domain.ts'
import type { JsonRequest } from './gemini.ts'
import type { ScrapedItem } from './fetchers/types.ts'

export const FOCUSES = ['revendications', 'mobilisation', 'incidents', 'mixte'] as const
export const TONES = ['favorable', 'neutre', 'defavorable'] as const
export const VOICES = [
  'lyceens',
  'enseignants_syndicats',
  'parents',
  'direction_rectorat',
  'police_prefecture',
  'politiques',
] as const
/** Mots pour désigner les participants : on note ceux que l'article emploie. */
export const TERMS = [
  'lycéens',
  'élèves',
  'jeunes',
  'manifestants',
  'mobilisés',
  'grévistes',
  'bloqueurs',
  'casseurs',
  'émeutiers',
  'militants',
  'individus',
] as const

const quote = z
  .string()
  .nullable()
  .transform((s) => (s ? s.replace(/\s+/g, ' ').trim().slice(0, 240) : null))

export const mediaAnalysisSchema = z.object({
  item_id: z.string(),
  about_movement: z.boolean(),
  mentions_demands: z.boolean(),
  demands: z.array(z.string()).max(8).catch([]),
  voices: z.array(z.enum(VOICES)).catch([]),
  focus: z.enum(FOCUSES),
  incidents: z.boolean(),
  police_violence: z.boolean(),
  terms: z.array(z.enum(TERMS)).catch([]),
  tone: z.enum(TONES),
  quote_demands: quote,
  quote_framing: quote,
})
export type MediaAnalysis = z.infer<typeof mediaAnalysisSchema>

export const MEDIA_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    articles: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          item_id: { type: 'STRING' },
          about_movement: {
            type: 'BOOLEAN',
            description: "L'article parle de la mobilisation lycéenne (blocus, manifestation).",
          },
          mentions_demands: {
            type: 'BOOLEAN',
            description: 'Les raisons ou revendications des lycéens sont exposées.',
          },
          demands: {
            type: 'ARRAY',
            items: { type: 'STRING' },
            description: 'Revendications citées, 2 à 5 mots chacune. Vide si aucune.',
          },
          voices: {
            type: 'ARRAY',
            items: { type: 'STRING', enum: [...VOICES] },
            description: "Qui s'exprime (citation directe ou indirecte) dans l'article.",
          },
          focus: {
            type: 'STRING',
            enum: [...FOCUSES],
            description:
              'Angle principal : revendications (le pourquoi), mobilisation (déroulé, ampleur), incidents (dégradations, violences, interpellations, troubles), mixte.',
          },
          incidents: {
            type: 'BOOLEAN',
            description: 'Dégradations, violences, interpellations ou troubles sont mentionnés.',
          },
          police_violence: {
            type: 'BOOLEAN',
            description: 'Des violences ou un usage de la force par la police sont mentionnés.',
          },
          terms: {
            type: 'ARRAY',
            items: { type: 'STRING', enum: [...TERMS] },
            description: "Mots employés par l'article pour désigner les participants.",
          },
          tone: {
            type: 'STRING',
            enum: [...TONES],
            description: "Ton de l'article envers la mobilisation.",
          },
          quote_demands: {
            type: 'STRING',
            nullable: true,
            description:
              'Extrait exact (≤ 200 caractères) qui expose les revendications, sinon null.',
          },
          quote_framing: {
            type: 'STRING',
            nullable: true,
            description:
              "Extrait exact (≤ 200 caractères) le plus représentatif de l'angle choisi.",
          },
        },
        required: [
          'item_id',
          'about_movement',
          'mentions_demands',
          'demands',
          'voices',
          'focus',
          'incidents',
          'police_violence',
          'terms',
          'tone',
          'quote_demands',
          'quote_framing',
        ],
      },
    },
  },
  required: ['articles'],
} as const

export const MEDIA_SYSTEM_PROMPT = `Tu analyses la façon dont des articles de presse français traitent la mobilisation des lycéens (blocus, manifestations).

Pour chaque article, réponds de façon factuelle, uniquement d'après le texte fourni :
- about_movement : false si l'article ne parle pas de la mobilisation lycéenne (alors le reste importe peu).
- mentions_demands : true si l'article nomme la cause ou les revendications des lycéens, même brièvement ; false s'il décrit le blocus sans dire pourquoi.
- demands : les revendications nommées, en quelques mots chacune.
- voices : qui s'exprime réellement dans l'article (citation directe ou rapportée).
- focus : l'angle dominant. "incidents" si l'article parle surtout de dégradations, poubelles brûlées, violences, interpellations, perturbations.
- terms : les mots que l'article emploie pour désigner les participants (parmi la liste).
- tone : envers la mobilisation. "defavorable" si elle est présentée surtout comme un problème (désordre, danger, élèves manipulés), "favorable" si ses raisons sont présentées avec sympathie, sinon "neutre".
- quote_demands / quote_framing : recopie mot pour mot un court extrait du texte (≤ 200 caractères). N'invente jamais d'extrait ; null s'il n'y en a pas.
Ne recopie aucun nom de personne mineure. Réponds uniquement avec le JSON demandé.`

export function mediaRequest(batch: ReadonlyArray<{ id: string; item: ScrapedItem }>): JsonRequest {
  const payload = batch.map(({ id, item }) => ({ id, texte: item.text.slice(0, 6000) }))
  return {
    system: MEDIA_SYSTEM_PROMPT,
    user: `Articles à analyser (JSON) :\n${JSON.stringify(payload)}`,
    schema: MEDIA_RESPONSE_SCHEMA,
  }
}

/** Valide la sortie ; une citation absente du texte (inventée) est retirée. */
export function parseMediaAnalyses(
  raw: unknown,
  batch: ReadonlyArray<{ id: string; item: ScrapedItem }>,
): MediaAnalysis[] {
  const list = (raw as { articles?: unknown })?.articles
  if (!Array.isArray(list)) return []
  const texts = new Map(batch.map((b) => [b.id, normalizeForQuote(b.item.text)]))
  const out: MediaAnalysis[] = []
  for (const candidate of list) {
    const parsed = mediaAnalysisSchema.safeParse(candidate)
    if (!parsed.success) continue
    const text = texts.get(parsed.data.item_id)
    if (text == null) continue
    const verified = (q: string | null) => (q && text.includes(normalizeForQuote(q)) ? q : null)
    out.push({
      ...parsed.data,
      demands: parsed.data.demands.map((d) => d.trim().slice(0, 60)).filter(Boolean),
      quote_demands: verified(parsed.data.quote_demands),
      quote_framing: verified(parsed.data.quote_framing),
    })
  }
  return out
}

function normalizeForQuote(s: string): string {
  return s
    .toLowerCase()
    .replace(/[«»"“”'’]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Articles de presse : flux RSS et Google Actualités (pas Telegram, Bluesky ni cartes). */
export function isPressItem(sourceKind: string, item: ScrapedItem): boolean {
  if (sourceKind !== 'rss') return false
  const domain = item.publisherDomain ?? extractDomain(item.url)
  return !!domain && !domain.endsWith('news.google.com')
}

export function articleDomain(item: ScrapedItem): string | null {
  return item.publisherDomain ?? extractDomain(item.url)
}

/** Titre : première ligne du texte collecté (le flux le place en tête). */
export function articleTitle(item: ScrapedItem): string {
  return (item.text.split('\n')[0] ?? '').trim().slice(0, 300)
}

/** Lignes à enregistrer (table media_analyses) pour les analyses d'un lot. */
export function mediaRows(
  analyses: ReadonlyArray<MediaAnalysis>,
  batch: ReadonlyArray<{ id: string; item: ScrapedItem; source: { id: string } }>,
  model: string | null,
) {
  const byId = new Map(batch.map((b) => [b.id, b]))
  return analyses.flatMap((a) => {
    const b = byId.get(a.item_id)
    const domain = b && articleDomain(b.item)
    if (!b || !domain) return []
    const { item_id: _id, ...answers } = a
    return [
      {
        ...answers,
        url: canonicalUrl(b.item.url),
        domain,
        title: articleTitle(b.item),
        source_id: b.source.id,
        published_at: b.item.publishedAt.toISOString(),
        model,
      },
    ]
  })
}
