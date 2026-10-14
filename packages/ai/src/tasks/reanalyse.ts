/**
 * Re-analysis of extractions that matched no school: the AI gets more context (title and summary
 * of the source page) and the candidate schools, and picks the right one, or none.
 */
import { meetsCertainty, type Certainty } from '@manifeste/core'
import { Type as t } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { Chain } from '../chain.ts'
import { REANALYSE_SYSTEM } from '../prompts/reanalyse.ts'
import { Enum, Nullable, Strict } from '../schema.ts'
import type { JsonRequest } from '../types.ts'

export interface Candidate {
  uai: string
  name: string
  city: string
  department: string | null
}

export interface ReanalyseItem {
  id: string
  schoolName: string
  city: string | null
  status: string
  /** Title and summary of the source page. */
  context: string
  candidates: readonly Candidate[]
}

const CERTAINTY_FROM_WIRE = { haute: 'high', moyenne: 'medium', faible: 'low' } as const

const answerSchema = Strict({
  choices: t.Array(
    Strict({
      id: t.String(),
      uai: Nullable(t.String()),
      certainty: Enum(['haute', 'moyenne', 'faible'] as const),
    }),
  ),
})
const choiceSchema = t.Object({
  id: t.String(),
  uai: Nullable(t.String()),
  certainty: Enum(['haute', 'moyenne', 'faible'] as const),
})

export function buildReanalyseRequest(items: readonly ReanalyseItem[]): JsonRequest {
  const payload = items.map((i) => ({
    id: i.id,
    fait: { lycee: i.schoolName, commune: i.city, statut: i.status },
    source: i.context || '(texte indisponible)',
    candidats: i.candidates.map((c) => ({
      uai: c.uai,
      nom: c.name,
      commune: c.city,
      departement: c.department,
    })),
  }))
  return {
    system: REANALYSE_SYSTEM,
    user: `Faits à rattacher (JSON) :\n${JSON.stringify(payload)}`,
    schema: answerSchema,
  }
}

/** Keeps the confident choices whose UAI really is among the candidates offered. item id → UAI. */
export function parseChoices(
  raw: unknown,
  items: readonly ReanalyseItem[],
  minCertainty: Certainty = 'medium',
): Map<string, string> {
  const out = new Map<string, string>()
  const list = (raw as { choices?: unknown } | null)?.choices
  if (!Array.isArray(list)) return out
  const byId = new Map(items.map((i) => [i.id, i]))
  for (const candidate of list) {
    if (!Value.Check(choiceSchema, candidate) || !candidate.uai) continue
    const item = byId.get(candidate.id)
    if (!item || !meetsCertainty(CERTAINTY_FROM_WIRE[candidate.certainty], minCertainty)) continue
    if (!item.candidates.some((k) => k.uai === candidate.uai)) continue
    out.set(item.id, candidate.uai)
  }
  return out
}

export async function reanalyse(
  chain: Chain,
  items: readonly ReanalyseItem[],
  minCertainty?: Certainty,
): Promise<Map<string, string>> {
  if (items.length === 0) return new Map()
  const { json } = await chain.generate(buildReanalyseRequest(items))
  return parseChoices(json, items, minCertainty)
}
