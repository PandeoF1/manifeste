/**
 * Route detection: marches announced or under way in a press article, with the places they pass
 * through in order. Every place must be backed by a quote that is really in the text; the model's
 * word alone is never enough. The article text is not stored here.
 */
import { type Static, Type as t } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { Chain } from '../chain.ts'
import { ROUTES_SYSTEM } from '../prompts/routes.ts'
import { Enum, Nullable, Strict } from '../schema.ts'
import type { JsonRequest } from '../types.ts'

export const ROUTE_TIMINGS = ['announced', 'ongoing', 'past'] as const
const WIRE_TIMING = { annonce: 'announced', en_cours: 'ongoing', bilan: 'past' } as const

const wirePlace = { name: t.String(), quote: t.String() }
const wireMarch = {
  city: t.String(),
  day: Nullable(t.String({ description: 'AAAA-MM-JJ ou null' })),
  timing: Enum(Object.keys(WIRE_TIMING) as Array<keyof typeof WIRE_TIMING>),
  title: t.String(),
  lyceens_etudiants_preuve: Nullable(
    t.String({
      description:
        'Extrait exact (≤ 200 caractères) montrant que des lycéens ou des étudiants participent à CE cortège ; null sinon.',
    }),
  ),
  places: t.Array(Strict(wirePlace)),
}
const answerSchema = Strict({
  articles: t.Array(Strict({ item_id: t.String(), marches: t.Array(Strict(wireMarch)) })),
})
const lenient = t.Object({
  item_id: t.String(),
  marches: t.Array(
    t.Object({
      ...wireMarch,
      timing: t.String(),
      places: t.Array(t.Object(wirePlace)),
    }),
  ),
})

export interface DetectedPlace {
  name: string
  quote: string
}
export interface DetectedMarch {
  itemId: string
  city: string
  /** YYYY-MM-DD, or null. */
  day: string | null
  timing: (typeof ROUTE_TIMINGS)[number]
  title: string
  places: DetectedPlace[]
}

export interface RoutesItem {
  id: string
  text: string
  /** ISO date of publication, to resolve "mardi" and the like. */
  publishedOn: string
}

export function buildRoutesRequest(items: readonly RoutesItem[]): JsonRequest {
  const payload = items.map(({ id, text, publishedOn }) => ({
    id,
    publie_le: publishedOn,
    texte: text.slice(0, 8000),
  }))
  return {
    system: ROUTES_SYSTEM,
    user: `Articles à analyser (JSON) :\n${JSON.stringify(payload)}`,
    schema: answerSchema,
  }
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[«»"“”'’]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const validDay = (d: string | null): string | null => {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null
  const date = new Date(`${d}T00:00:00Z`)
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== d ? null : d
}

/**
 * Validates the answer. A place whose quote is not in the text, or whose name is not in its own
 * quote, is dropped; a march left with fewer than two places is dropped; a march whose city is
 * not in the text is dropped.
 */
export function parseRoutes(raw: unknown, items: readonly RoutesItem[]): DetectedMarch[] {
  const list = (raw as { articles?: unknown } | null)?.articles
  if (!Array.isArray(list)) return []
  const texts = new Map(items.map((i) => [i.id, norm(i.text)]))
  const out: DetectedMarch[] = []
  for (const candidate of list) {
    if (!Value.Check(lenient, candidate)) continue
    const a: Static<typeof lenient> = candidate
    const text = texts.get(a.item_id)
    if (text == null) continue
    for (const m of a.marches) {
      if (!(m.timing in WIRE_TIMING)) continue
      // Only marches of the movement: the article must say that lycéens or students take part, and
      // the sentence that says so must be in the text (a taxi or farmers' march is not ours).
      const proof = m.lyceens_etudiants_preuve?.replace(/\s+/g, ' ').trim()
      if (!proof || !text.includes(norm(proof))) continue
      const city = m.city.trim().slice(0, 80)
      if (!city || !text.includes(norm(city))) continue
      const places: DetectedPlace[] = []
      for (const p of m.places) {
        const name = p.name.replace(/\s+/g, ' ').trim().slice(0, 120)
        const quote = p.quote.replace(/\s+/g, ' ').trim().slice(0, 240)
        if (!name || !quote) continue
        if (!text.includes(norm(quote)) || !norm(quote).includes(norm(name))) continue
        if (places.some((q) => norm(q.name) === norm(name))) continue
        places.push({ name, quote })
      }
      if (places.length < 2) continue
      out.push({
        itemId: a.item_id,
        city,
        day: validDay(m.day),
        timing: WIRE_TIMING[m.timing as keyof typeof WIRE_TIMING],
        title: m.title.replace(/\s+/g, ' ').trim().slice(0, 80),
        places: places.slice(0, 20),
      })
    }
  }
  return out
}

export async function detectRoutes(
  chain: Chain,
  items: readonly RoutesItem[],
): Promise<DetectedMarch[]> {
  if (items.length === 0) return []
  const { json } = await chain.generate(buildRoutesRequest(items))
  return parseRoutes(json, items)
}
