/**
 * The same judge questions answered by a general model (Gemini, Claude…), so a benchmark can
 * compare it with Jev on the labelled sample. It fits the same `Judge` port.
 */
import { sentencesAbout, type JudgeLevel, type JudgeNature } from '@manifeste/core'
import { Type as t } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { Chain } from '../chain.ts'
import {
  blockedQuestion,
  LLM_JUDGE_SYSTEM,
  levelQuestion,
  natureQuestion,
  WIRE_JUDGE_LEVELS,
  WIRE_JUDGE_NATURES,
} from '../prompts/judge.ts'
import { MIN_JUDGE_CHARS, type Judge } from '../ports.ts'
import { Enum, Strict } from '../schema.ts'

const NATURE_KEYS = Object.keys(WIRE_JUDGE_NATURES) as Array<keyof typeof WIRE_JUDGE_NATURES>
const LEVEL_KEYS = Object.keys(WIRE_JUDGE_LEVELS) as Array<keyof typeof WIRE_JUDGE_LEVELS>

const answer = Strict({
  probability: t.Number({ minimum: 0, maximum: 1 }),
  nature: Enum(NATURE_KEYS),
  level: Enum(LEVEL_KEYS),
})

const NATURE: Record<(typeof NATURE_KEYS)[number], JudgeNature> = {
  blocage: 'blockade',
  ferme: 'closed',
  rassemblement: 'gathering',
  incident: 'incident',
  autre: 'other',
}
const LEVEL: Record<(typeof LEVEL_KEYS)[number], JudgeLevel> = {
  lycee: 'secondary',
  superieur: 'higher',
  inconnu: 'unknown',
}
const WIRE_STATUS = { blocked: 'bloque', filtering: 'filtrant', lifted: 'leve' } as const

export function llmJudge(chain: Chain, label: { provider: string; model: string }): Judge {
  return {
    ...label,
    async judge(input) {
      if (input.text.length < MIN_JUDGE_CHARS) return null
      const who = `« ${input.school.name} » (${input.school.city})`
      const sentences = sentencesAbout(input.text, input.school)
      const body = (sentences.length ? sentences.join('\n') : input.text.slice(0, 1200)).slice(
        0,
        2000,
      )
      const user = [
        `Article publié le ${input.publishedDay}`,
        `Titre : ${input.title ?? ''}`,
        '',
        body,
        '',
        `Question 1 (probability) : ${blockedQuestion(who, WIRE_STATUS[input.status])}`,
        `Question 2 (nature) : ${natureQuestion(who)}`,
        ...Object.entries(WIRE_JUDGE_NATURES).map(([k, v]) => `  - "${k}" : ${v}`),
        `Question 3 (level) : ${levelQuestion(who)}`,
        ...Object.entries(WIRE_JUDGE_LEVELS).map(([k, v]) => `  - "${k}" : ${v}`),
      ].join('\n')
      const result = await chain.generate({ system: LLM_JUDGE_SYSTEM, user, schema: answer })
      if (!Value.Check(answer, result.json)) return null
      return {
        probability: result.json.probability,
        nature: NATURE[result.json.nature],
        natureProbabilities: {},
        level: LEVEL[result.json.level],
        levelProbabilities: {},
        provider: result.provider,
        model: result.model,
        chars: user.length,
      }
    },
  }
}
