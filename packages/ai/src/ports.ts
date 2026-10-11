import type { JudgeLevel, JudgeNature, ReportStatus } from '@manifeste/core'

export interface JudgeInput {
  school: { name: string; city: string }
  status: ReportStatus
  title?: string
  text: string
  /** Publication day (YYYY-MM-DD, Paris time). */
  publishedDay: string
}

export interface JudgeVerdict {
  /** Probability that the article says what the status claims. */
  probability: number
  nature: JudgeNature | null
  natureProbabilities: Record<string, number>
  level: JudgeLevel | null
  levelProbabilities: Record<string, number>
  provider: string
  model: string
  /** Characters of article sent. */
  chars: number
}

/** A second opinion on one report. It decides nothing: the pipeline stores its answer. */
export interface Judge {
  readonly provider: string
  readonly model: string
  /** null when the text is too short to judge or the judge is unavailable. */
  judge(input: JudgeInput): Promise<JudgeVerdict | null>
}

/** Text too short to judge: nothing is asked (the judge was not measured on titles alone). */
export const MIN_JUDGE_CHARS = 300
