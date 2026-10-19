/**
 * Signaled mobilisations: the street demonstrations a press article reports, with the most precise
 * place it names for each. Every place must be backed by a quote that is really in the text.
 */
import { type Static, Type as t } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { Chain } from '../chain.ts'
import { SIGNALS_SYSTEM } from '../prompts/signals.ts'
import { Enum, Nullable, Strict } from '../schema.ts'
import type { JsonRequest } from '../types.ts'

export const SIGNAL_LEVELS = ['street', 'place', 'district', 'neighbourhood', 'city'] as const
const WIRE_LEVEL = {
  rue: 'street',
  lieu: 'place',
  arrondissement: 'district',
  quartier: 'neighbourhood',
  ville: 'city',
} as const
const WIRE_TIMING = { annonce: 'announced', en_cours: 'ongoing', bilan: 'past' } as const

const wirePlace = {
  name: t.String(),
  niveau: Enum(Object.keys(WIRE_LEVEL) as Array<keyof typeof WIRE_LEVEL>),
  quote: t.String(),
}
const wireSignal = {
  city: t.String(),
  day: Nullable(t.String({ description: 'AAAA-MM-JJ ou null' })),
  timing: Enum(Object.keys(WIRE_TIMING) as Array<keyof typeof WIRE_TIMING>),
  title: t.String(),
  lieu: Strict(wirePlace),
}
const answerSchema = Strict({
  articles: t.Array(Strict({ item_id: t.String(), mobilisations: t.Array(Strict(wireSignal)) })),
})
const lenient = t.Object({
  item_id: t.String(),
  mobilisations: t.Array(
    t.Object({
      ...wireSignal,
      timing: t.String(),
      lieu: t.Object({ name: t.String(), niveau: t.String(), quote: t.String() }),
    }),
  ),
})

export interface DetectedSignal {
  itemId: string
  city: string
  day: string | null
  timing: 'announced' | 'ongoing' | 'past'
  title: string
  place: { name: string; level: (typeof SIGNAL_LEVELS)[number]; quote: string }
}

export interface SignalsItem {
  id: string
  text: string
  /** ISO date of publication, to resolve "samedi" and the like. */
  publishedOn: string
}

export function buildSignalsRequest(items: readonly SignalsItem[]): JsonRequest {
  const payload = items.map(({ id, text, publishedOn }) => ({
    id,
    publie_le: publishedOn,
    texte: text.slice(0, 6000),
  }))
  return {
    system: SIGNALS_SYSTEM,
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
 * Validates the answer. An entry whose city is not in the text, whose quote is not in the text, or
 * whose place name is not in its own quote is dropped (a place that cannot be backed falls back to
 * "city" only when the city itself is quoted); one entry per city and article.
 */
export function parseSignals(raw: unknown, items: readonly SignalsItem[]): DetectedSignal[] {
  const list = (raw as { articles?: unknown } | null)?.articles
  if (!Array.isArray(list)) return []
  const texts = new Map(items.map((i) => [i.id, norm(i.text)]))
  const out: DetectedSignal[] = []
  for (const candidate of list) {
    if (!Value.Check(lenient, candidate)) continue
    const a: Static<typeof lenient> = candidate
    const text = texts.get(a.item_id)
    if (text == null) continue
    const seen = new Set<string>()
    for (const m of a.mobilisations) {
      if (!(m.timing in WIRE_TIMING) || !(m.lieu.niveau in WIRE_LEVEL)) continue
      const city = m.city.replace(/\s+/g, ' ').trim().slice(0, 80)
      if (!city || !text.includes(norm(city)) || seen.has(norm(city))) continue
      const name = m.lieu.name.replace(/\s+/g, ' ').trim().slice(0, 120)
      const quote = m.lieu.quote.replace(/\s+/g, ' ').trim().slice(0, 240)
      const level = WIRE_LEVEL[m.lieu.niveau as keyof typeof WIRE_LEVEL]
      let place = { name, level, quote }
      const backed = name && quote && text.includes(norm(quote)) && norm(quote).includes(norm(name))
      if (!backed) {
        // The precise place is not in the text: keep the mobilisation at the level of the city.
        place = { name: city, level: 'city', quote: city }
      }
      seen.add(norm(city))
      out.push({
        itemId: a.item_id,
        city,
        day: validDay(m.day),
        timing: WIRE_TIMING[m.timing as keyof typeof WIRE_TIMING],
        title: m.title.replace(/\s+/g, ' ').trim().slice(0, 80),
        place,
      })
    }
  }
  return out
}

export async function detectSignals(
  chain: Chain,
  items: readonly SignalsItem[],
): Promise<DetectedSignal[]> {
  if (items.length === 0) return []
  const { json } = await chain.generate(buildSignalsRequest(items))
  return parseSignals(json, items)
}
