/**
 * Jev (TypeSafe AI): a judge model that answers questions with probabilities.
 * POST https://api.typesafe.ai/v1/systemone. The model is pinned: "jev-latest" may change
 * without notice.
 */
import { sentencesAbout, type JudgeNature } from '@manifeste/core'
import { costOf, type PriceTable } from '../pricing.ts'
import {
  blockedQuestion,
  levelQuestion,
  natureQuestion,
  WIRE_JUDGE_LEVELS,
  WIRE_JUDGE_NATURES,
  type WireJudgeStatus,
} from '../prompts/judge.ts'
import { MIN_JUDGE_CHARS, type Judge, type JudgeInput, type JudgeVerdict } from '../ports.ts'
import type { FetchLike, UsageSink } from '../types.ts'

export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
export const JEV_MODEL = 'jev-1.13.0'

const NATURE_FROM_WIRE: Record<keyof typeof WIRE_JUDGE_NATURES, JudgeNature> = {
  blocage: 'blockade',
  ferme: 'closed',
  rassemblement: 'gathering',
  incident: 'incident',
  autre: 'other',
}
const LEVEL_FROM_WIRE = { lycee: 'secondary', superieur: 'higher', inconnu: 'unknown' } as const
const STATUS_TO_WIRE: Record<JudgeInput['status'], WireJudgeStatus> = {
  blocked: 'bloque',
  filtering: 'filtrant',
  lifted: 'leve',
}

interface JevQuestion {
  type: 'noul' | 'choice'
  instructions: string
  criteria?: Record<string, string>
}

export function buildJevQuestions(
  school: { name: string; city: string },
  status: JudgeInput['status'],
): Record<string, JevQuestion> {
  const who = `« ${school.name} » (${school.city}) `.trim()
  return {
    bloque: { type: 'noul', instructions: blockedQuestion(who, STATUS_TO_WIRE[status]) },
    nature: {
      type: 'choice',
      instructions: natureQuestion(who),
      criteria: { ...WIRE_JUDGE_NATURES },
    },
    level: { type: 'choice', instructions: levelQuestion(who), criteria: { ...WIRE_JUDGE_LEVELS } },
  }
}

const numbers = (o: unknown): Record<string, number> =>
  o && typeof o === 'object'
    ? Object.fromEntries(
        Object.entries(o as Record<string, unknown>).filter(
          (e): e is [string, number] => typeof e[1] === 'number',
        ),
      )
    : {}

/** Reads /v1/systemone's answer; tolerates missing fields. null when there is no probability. */
export function parseJevResponse(
  raw: unknown,
): Pick<
  JudgeVerdict,
  'probability' | 'nature' | 'natureProbabilities' | 'level' | 'levelProbabilities'
> | null {
  const answers = (raw as { answers?: Record<string, Record<string, unknown>> } | null)?.answers
  const noul = answers?.bloque?.noul
  if (typeof noul !== 'number' || noul < 0 || noul > 1) return null
  const nature = answers?.nature?.choice
  const level = answers?.level?.choice
  const known = <T extends object>(table: T, key: unknown): key is keyof T =>
    typeof key === 'string' && key in table
  return {
    probability: noul,
    nature: known(NATURE_FROM_WIRE, nature) ? NATURE_FROM_WIRE[nature] : null,
    natureProbabilities: mapKeys(numbers(answers?.nature?.probabilities), NATURE_FROM_WIRE),
    level: known(LEVEL_FROM_WIRE, level) ? LEVEL_FROM_WIRE[level] : null,
    levelProbabilities: mapKeys(numbers(answers?.level?.probabilities), LEVEL_FROM_WIRE),
  }
}

const mapKeys = (
  o: Record<string, number>,
  table: Record<string, string>,
): Record<string, number> =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [table[k] ?? k, v]))

/**
 * Text sent to the judge: the title and the sentences about the school, not the whole article
 * (Jev's docs warn that a state full of unrelated detail lowers precision).
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

export interface JevOptions {
  apiKey: string
  model?: string
  fetch?: FetchLike
  timeoutMs?: number
  sink?: UsageSink
  prices?: PriceTable
}

export function jevJudge(options: JevOptions): Judge {
  const fetchFn = options.fetch ?? fetch
  const model = options.model ?? JEV_MODEL
  return {
    provider: 'jev',
    model,
    async judge(input) {
      if (input.text.length < MIN_JUDGE_CHARS) return null
      const state = focusState(
        { title: input.title ?? '', text: input.text },
        input.school,
        input.publishedDay,
      )
      const started = performance.now()
      const body = JSON.stringify({
        state,
        model,
        questions: buildJevQuestions(input.school, input.status),
      })
      const record = (outcome: 'ok' | 'unavailable' | 'invalid-output', promptTokens: number) =>
        options.sink?.record({
          task: 'judge',
          provider: 'jev',
          model,
          promptVersion: 'v1',
          usage: {
            calls: outcome === 'unavailable' ? 0 : 1,
            promptTokens,
            outputTokens: 0,
            thoughtsTokens: 0,
          },
          latencyMs: Math.round(performance.now() - started),
          outcome,
          costUsd: options.prices
            ? costOf(options.prices, model, {
                calls: 1,
                promptTokens,
                outputTokens: 0,
                thoughtsTokens: 0,
              })
            : 0,
        })
      try {
        const res = await fetchFn(JEV_ENDPOINT, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            'content-type': 'application/json',
          },
          body,
          signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
        })
        if (!res.ok) {
          record('unavailable', 0)
          return null
        }
        const tokens = Math.ceil(body.length / 4) // about 4 characters a token
        const answer = parseJevResponse(await res.json())
        record(answer ? 'ok' : 'invalid-output', tokens)
        return answer && { ...answer, provider: 'jev', model, chars: state.length }
      } catch {
        record('unavailable', 0)
        return null
      }
    },
  }
}
