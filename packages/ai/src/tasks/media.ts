/**
 * Media-treatment analysis: for each press article the AI answers factual questions (demands
 * cited? who speaks? incidents or mobilisation angle? vocabulary?) with a quote as evidence. The
 * article text is not stored: only these answers, the address and the title.
 */
import { type Static, Type as t } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { Chain } from '../chain.ts'
import { MEDIA_SYSTEM } from '../prompts/media.ts'
import { Enum, Nullable, Strict } from '../schema.ts'
import type { JsonRequest } from '../types.ts'

export const FOCUSES = ['demands', 'mobilisation', 'incidents', 'mixed'] as const
export const TONES = ['favourable', 'neutral', 'unfavourable'] as const
export const VOICES = [
  'students',
  'teachers_unions',
  'parents',
  'school_authorities',
  'police_prefecture',
  'politicians',
] as const
/** Words for the participants: the ones the article uses are noted (French, as printed). */
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

// The prompt names these values in French; they are mapped to the English ones above.
const WIRE_FOCUS = {
  revendications: 'demands',
  mobilisation: 'mobilisation',
  incidents: 'incidents',
  mixte: 'mixed',
} as const
const WIRE_TONE = {
  favorable: 'favourable',
  neutre: 'neutral',
  defavorable: 'unfavourable',
} as const
const WIRE_VOICE = {
  lyceens: 'students',
  enseignants_syndicats: 'teachers_unions',
  parents: 'parents',
  direction_rectorat: 'school_authorities',
  police_prefecture: 'police_prefecture',
  politiques: 'politicians',
} as const

const wireAnswer = {
  item_id: t.String(),
  about_movement: t.Boolean({
    description:
      "L'article parle de la mobilisation lycéenne ou étudiante (blocus, manifestation).",
  }),
  mentions_demands: t.Boolean({
    description: 'Les raisons ou revendications des lycéens sont exposées.',
  }),
  demands: t.Array(t.String(), {
    description: 'Revendications citées, 2 à 5 mots chacune. Vide si aucune.',
  }),
  voices: t.Array(Enum(Object.keys(WIRE_VOICE) as Array<keyof typeof WIRE_VOICE>), {
    description: "Qui s'exprime (citation directe ou indirecte) dans l'article.",
  }),
  focus: Enum(Object.keys(WIRE_FOCUS) as Array<keyof typeof WIRE_FOCUS>, 'Angle principal.'),
  incidents: t.Boolean({
    description: 'Dégradations, violences, interpellations ou troubles sont mentionnés.',
  }),
  police_violence: t.Boolean({
    description: 'Des violences ou un usage de la force par la police sont mentionnés.',
  }),
  terms: t.Array(Enum(TERMS), {
    description: "Mots employés par l'article pour désigner les participants.",
  }),
  tone: Enum(
    Object.keys(WIRE_TONE) as Array<keyof typeof WIRE_TONE>,
    "Ton de l'article envers la mobilisation.",
  ),
  quote_demands: Nullable(
    t.String({
      description: 'Extrait exact (≤ 200 caractères) qui expose les revendications, sinon null.',
    }),
  ),
  quote_framing: Nullable(
    t.String({
      description: "Extrait exact (≤ 200 caractères) le plus représentatif de l'angle choisi.",
    }),
  ),
}
const answerSchema = Strict({ articles: t.Array(Strict(wireAnswer)) })
// Lists are read leniently: an unknown word in `voices` or `terms` is dropped, not the analysis.
const wireItem = t.Object({
  ...wireAnswer,
  voices: t.Array(t.String()),
  terms: t.Array(t.String()),
  focus: t.String(),
  tone: t.String(),
})

export interface MediaAnalysis {
  itemId: string
  aboutMovement: boolean
  mentionsDemands: boolean
  demands: string[]
  voices: Array<(typeof VOICES)[number]>
  focus: (typeof FOCUSES)[number]
  incidents: boolean
  policeViolence: boolean
  terms: Array<(typeof TERMS)[number]>
  tone: (typeof TONES)[number]
  quoteDemands: string | null
  quoteFraming: string | null
}

export interface MediaItem {
  id: string
  text: string
}

export function buildMediaRequest(items: readonly MediaItem[]): JsonRequest {
  const payload = items.map(({ id, text }) => ({ id, texte: text.slice(0, 6000) }))
  return {
    system: MEDIA_SYSTEM,
    user: `Articles à analyser (JSON) :\n${JSON.stringify(payload)}`,
    schema: answerSchema,
  }
}

const normalizeForQuote = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[«»"“”'’]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const clean = (q: string | null): string | null =>
  q ? q.replace(/\s+/g, ' ').trim().slice(0, 240) || null : null

/** Validates the answer; a quote that is not in the text (invented) is removed. */
export function parseMediaAnalyses(raw: unknown, items: readonly MediaItem[]): MediaAnalysis[] {
  const list = (raw as { articles?: unknown } | null)?.articles
  if (!Array.isArray(list)) return []
  const texts = new Map(items.map((i) => [i.id, normalizeForQuote(i.text)]))
  const out: MediaAnalysis[] = []
  for (const candidate of list) {
    if (!Value.Check(wireItem, candidate)) continue
    const a: Static<typeof wireItem> = candidate
    if (!(a.focus in WIRE_FOCUS) || !(a.tone in WIRE_TONE)) continue
    const text = texts.get(a.item_id)
    if (text == null) continue
    const verified = (q: string | null) => {
      const quote = clean(q)
      return quote && text.includes(normalizeForQuote(quote)) ? quote : null
    }
    out.push({
      itemId: a.item_id,
      aboutMovement: a.about_movement,
      mentionsDemands: a.mentions_demands,
      demands: a.demands
        .slice(0, 8)
        .map((d) => d.trim().slice(0, 60))
        .filter(Boolean),
      voices: a.voices.flatMap((v) =>
        v in WIRE_VOICE ? [WIRE_VOICE[v as keyof typeof WIRE_VOICE]] : [],
      ),
      focus: WIRE_FOCUS[a.focus as keyof typeof WIRE_FOCUS],
      incidents: a.incidents,
      policeViolence: a.police_violence,
      terms: a.terms.filter((w): w is (typeof TERMS)[number] =>
        (TERMS as readonly string[]).includes(w),
      ),
      tone: WIRE_TONE[a.tone as keyof typeof WIRE_TONE],
      quoteDemands: verified(a.quote_demands),
      quoteFraming: verified(a.quote_framing),
    })
  }
  return out
}

export async function analyseMedia(
  chain: Chain,
  items: readonly MediaItem[],
): Promise<MediaAnalysis[]> {
  if (items.length === 0) return []
  const { json } = await chain.generate(buildMediaRequest(items))
  return parseMediaAnalyses(json, items)
}
