// Onglet « Coût IA » : lecture de admin_ai_usage et agrégation pour les graphiques.

export type AiTask = 'extraction' | 'media' | 'reanalyse' | 'backfill' | 'judge'

export const TASK_LABEL: Record<AiTask, string> = {
  extraction: 'Extraction (collecte)',
  media: 'Analyse des médias',
  reanalyse: 'Réanalyse des non rattachés',
  backfill: 'Rattrapage (script)',
  judge: 'Juge Jev (estimation)',
}

export interface UsageRow {
  /** Jour calendaire (heure de Paris), « 2026-10-06 ». */
  day: string
  task: AiTask
  model: string
  calls: number
  prompt: number
  /** Sortie, réflexion comprise (facturée au même tarif). */
  output: number
  thoughts: number
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const TASKS = Object.keys(TASK_LABEL)

export function parseAiUsage(raw: unknown): UsageRow[] {
  if (!Array.isArray(raw)) return []
  return (raw as Array<Record<string, unknown>>)
    .filter((r) => TASKS.includes(String(r.task)))
    .map((r) => ({
      day: String(r.day),
      task: r.task as AiTask,
      model: String(r.model),
      calls: num(r.calls),
      prompt: num(r.prompt_tokens),
      thoughts: num(r.thoughts_tokens),
      output: num(r.output_tokens) + num(r.thoughts_tokens),
    }))
}

/** Modèles connus, du moins cher au plus cher : une couleur fixe par modèle, jamais décalée. */
const KNOWN_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.6-flash',
  'gemini-3.8-flash',
]

export interface ModelSeries {
  key: string
  label: string
  /** Variable CSS de la série ; les modèles au-delà de 4 sont regroupés dans « Autres ». */
  color: string
}

const SERIES_VARS = ['--series-1', '--series-2', '--series-3', '--series-4'] as const
export const OTHER_MODELS = 'autres'

/** « gemini-3.5-flash-lite » -> « Gemini 3.5 Flash Lite ». */
export function modelLabel(model: string): string {
  if (model === OTHER_MODELS) return 'Autres modèles'
  return model
    .split('-')
    .map((w) => (w ? w[0]?.toUpperCase() + w.slice(1) : w))
    .join(' ')
}

/**
 * Séries du graphique : les modèles utilisés sur la période, dans l'ordre fixe des modèles
 * connus puis les inconnus par nom ; au-delà de 4, le reste est regroupé dans « Autres ».
 */
export function seriesFor(models: Iterable<string>): ModelSeries[] {
  const used = [...new Set(models)].sort((a, b) => {
    const ia = KNOWN_MODELS.indexOf(a)
    const ib = KNOWN_MODELS.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b)
  })
  // La couleur suit le modèle (sa place dans l'ordre connu), pas son rang dans la période.
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
  /** Valeur par série (même ordre que `series`). */
  values: number[]
  total: number
}

/** Un compteur par jour (zéro les jours sans appel) et par série, sur les `days` derniers jours. */
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

/** Totaux par tâche, de la plus gourmande (entrée + sortie) à la moins gourmande. */
export function byTask(rows: ReadonlyArray<UsageRow>): Array<{ task: AiTask } & Totals> {
  const map = new Map<AiTask, UsageRow[]>()
  for (const r of rows) map.set(r.task, [...(map.get(r.task) ?? []), r])
  return [...map]
    .map(([task, list]) => ({ task, ...totals(list) }))
    .sort((a, b) => b.prompt + b.output - (a.prompt + a.output))
}

/** « 1 234 » ; au-delà d'un million « 1,2 M », pour les valeurs de l'axe et des tuiles. */
export function compactTokens(n: number): string {
  if (n >= 1_000_000)
    return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace('.', ',')} M`
  if (n >= 10_000) return `${Math.round(n / 1000)} k`
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.', ',')} k`
  return String(Math.round(n))
}
