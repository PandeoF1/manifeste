// "AI" tab: the API's usage rows, aggregated for the charts.

export type AiTask = 'extract' | 'media' | 'reanalyse' | 'judge' | 'routes'

export const TASK_LABEL: Record<AiTask, string> = {
  extract: 'Extraction (collecte)',
  media: 'Analyse des médias',
  reanalyse: 'Réanalyse des non rattachés',
  judge: 'Juge (second avis)',
  routes: 'Détection de parcours',
}

export interface UsageRow {
  /** Calendar day (Paris time), "2026-10-06". */
  day: string
  task: AiTask
  model: string
  calls: number
  prompt: number
  /** Output, thinking included (billed at the same rate). */
  output: number
  thoughts: number
}

const TASKS = Object.keys(TASK_LABEL)

/** What the API returns for one day, task and model. */
export interface ApiUsage {
  day: string
  task: string
  model: string
  calls: number
  promptTokens: number
  outputTokens: number
  thoughtsTokens: number
}

export function fromApiUsage(rows: readonly ApiUsage[]): UsageRow[] {
  return rows
    .filter((r) => TASKS.includes(r.task))
    .map((r) => ({
      day: r.day,
      task: r.task as AiTask,
      model: r.model,
      calls: r.calls,
      prompt: r.promptTokens,
      thoughts: r.thoughtsTokens,
      output: r.outputTokens + r.thoughtsTokens,
    }))
}

/** Known models, cheapest first: one fixed colour per model, never shifted. */
const KNOWN_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.6-flash',
  'gemini-3.8-flash',
]

export interface ModelSeries {
  key: string
  label: string
  /** CSS variable of the series; models beyond the 4th are grouped under "Others". */
  color: string
}

const SERIES_VARS = ['--series-1', '--series-2', '--series-3', '--series-4'] as const
export const OTHER_MODELS = 'autres'

/** "gemini-3.5-flash-lite" -> "Gemini 3.5 Flash Lite". */
export function modelLabel(model: string): string {
  if (model === OTHER_MODELS) return 'Autres modèles'
  return model
    .split('-')
    .map((w) => (w ? w[0]?.toUpperCase() + w.slice(1) : w))
    .join(' ')
}

/**
 * Chart series: the models used over the period, in the fixed order of known models
 * then unknown ones by name; beyond 4, the rest is grouped under "Others".
 */
export function seriesFor(models: Iterable<string>): ModelSeries[] {
  const used = [...new Set(models)].sort((a, b) => {
    const ia = KNOWN_MODELS.indexOf(a)
    const ib = KNOWN_MODELS.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b)
  })
  // The colour follows the model (its place in the known order), not its rank in the period.
  const colorOf = (m: string, i: number) => {
    const k = KNOWN_MODELS.indexOf(m)
    return SERIES_VARS[k >= 0 && k < SERIES_VARS.length ? k : Math.min(i, SERIES_VARS.length - 1)]
  }
  const taken = new Set<string>()
  const out: ModelSeries[] = []
  for (const [i, m] of used.entries()) {
    if (out.length >= SERIES_VARS.length) break
    const color = colorOf(m, i) as string
    if (taken.has(color)) continue
    taken.add(color)
    out.push({ key: m, label: modelLabel(m), color: `var(${color})` })
  }
  if (used.length > out.length)
    out.push({ key: OTHER_MODELS, label: modelLabel(OTHER_MODELS), color: 'var(--muted)' })
  return out
}

export interface DayBucket {
  day: string
  /** Value per series (same order as `series`). */
  values: number[]
  total: number
}

/** One counter per day (zero on days without calls) and per series, over the last `days` days. */
export function dailyBuckets(
  rows: ReadonlyArray<UsageRow>,
  series: ReadonlyArray<ModelSeries>,
  field: 'prompt' | 'output' | 'calls',
  days: number,
  today: string,
): DayBucket[] {
  const index = new Map(series.map((s, i) => [s.key, i]))
  const other = index.get(OTHER_MODELS)
  const byDay = new Map<string, number[]>()
  for (let k = days - 1; k >= 0; k--) {
    const d = new Date(`${today}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() - k)
    byDay.set(
      d.toISOString().slice(0, 10),
      series.map(() => 0),
    )
  }
  for (const r of rows) {
    const cells = byDay.get(r.day)
    const i = index.get(r.model) ?? other
    if (cells && i != null) cells[i] = (cells[i] ?? 0) + r[field]
  }
  return [...byDay].map(([day, values]) => ({
    day,
    values,
    total: values.reduce((a, b) => a + b, 0),
  }))
}

export interface Totals {
  calls: number
  prompt: number
  output: number
  thoughts: number
}

export function totals(rows: ReadonlyArray<UsageRow>): Totals {
  return rows.reduce(
    (a, r) => ({
      calls: a.calls + r.calls,
      prompt: a.prompt + r.prompt,
      output: a.output + r.output,
      thoughts: a.thoughts + r.thoughts,
    }),
    { calls: 0, prompt: 0, output: 0, thoughts: 0 },
  )
}

/** Totals per task, from the most to the least token-hungry (input + output). */
export function byTask(rows: ReadonlyArray<UsageRow>): Array<{ task: AiTask } & Totals> {
  const map = new Map<AiTask, UsageRow[]>()
  for (const r of rows) map.set(r.task, [...(map.get(r.task) ?? []), r])
  return [...map]
    .map(([task, list]) => ({ task, ...totals(list) }))
    .sort((a, b) => b.prompt + b.output - (a.prompt + a.output))
}

/** "1 234"; above a million "1,2 M", for axis and tile values. */
export function compactTokens(n: number): string {
  if (n >= 1_000_000)
    return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace('.', ',')} M`
  if (n >= 10_000) return `${Math.round(n / 1000)} k`
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.', ',')} k`
  return String(Math.round(n))
}
