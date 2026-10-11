/**
 * Scores AI variants on the golden reports (datasets/ai/reports.jsonl).
 *
 *   bun ai/run.ts --task judge   --variants jev-recorded,jev,llm:gemini:gemini-3.5-flash [--live]
 *   bun ai/run.ts --task extract --variants v1@gemini:gemini-3.5-flash-lite,v1-strict@gemini:gemini-3.5-flash-lite [--live]
 *
 * Offline (default): every HTTP exchange comes from a recording, so the run is free, fast and
 * deterministic. A request with no recording counts as unanswered, and coverage says how many.
 * `--live` calls the real APIs (keys from the environment), records every exchange, and refuses to
 * go past `--max-usd` of estimated spend. Recordings contain article text, so they live next to the
 * corpus (private), never in git. Summaries, which contain no article text, land in results/ai.
 *
 * Options: --corpus DIR  --limit N  --batch N (extract)  --concurrency N  --rpm N
 *          --thinking N (Gemini thinking budget)  --max-usd X  --min-certainty high|medium|low
 *          --details (per-case JSONL)
 */
import {
  createAi,
  createMeter,
  httpStoreFromJson,
  httpStoreToJson,
  recordingFetch,
  replayFetch,
  AiError,
  type FetchLike,
  type HttpRecordingStore,
  type UsageRow,
} from '@manifeste/ai'
import { meetsCertainty, sameSchool, type Certainty } from '@manifeste/core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { loadCases, loadReportLabels, publishedDayOf, type Case } from './datasets.ts'
import {
  percentile,
  summarizeExtract,
  summarizeJudge,
  type ExtractOutcome,
  type JudgeOutcome,
} from './metrics.ts'
import {
  credentials,
  extractConfig,
  judgeConfig,
  parseExtractSpec,
  parseJudgeSpec,
} from './variants.ts'

const { values } = parseArgs({
  options: {
    task: { type: 'string', default: 'judge' },
    variants: { type: 'string' },
    live: { type: 'boolean', default: false },
    corpus: { type: 'string', default: join(homedir(), 'manifest-corpus') },
    limit: { type: 'string' },
    batch: { type: 'string', default: '1' },
    concurrency: { type: 'string', default: '2' },
    rpm: { type: 'string', default: '0' },
    thinking: { type: 'string' },
    'max-usd': { type: 'string', default: '1' },
    'min-certainty': { type: 'string', default: 'medium' },
    details: { type: 'boolean', default: false },
    out: { type: 'string', default: join(import.meta.dir, '../results/ai') },
  },
})

const task = values.task === 'extract' ? 'extract' : 'judge'
const live = values.live === true
const maxUsd = Number(values['max-usd'])
const thinking = values.thinking === undefined ? undefined : Number(values.thinking)
const minCertainty = values['min-certainty'] as Certainty
const specs = (values.variants ?? (task === 'judge' ? 'jev-recorded' : ''))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
if (specs.length === 0) throw new Error('--variants is required')

// --- Cases -------------------------------------------------------------------------------

const labels = (await loadReportLabels()).filter((l) => l.label !== 'unsure')
const limited = values.limit ? labels.slice(0, Number(values.limit)) : labels
const { cases, missing } = await loadCases(values.corpus ?? '', limited)
console.error(
  `${cases.length} cases with an article (${missing.length} labelled reports have no saved page)`,
)

// --- Recordings (HTTP level, shared by every variant of the task) --------------------------

const storePath = join(values.corpus ?? '', 'recordings', `ai-${task}.json`)
const store: HttpRecordingStore = await Bun.file(storePath)
  .text()
  .then(httpStoreFromJson)
  .catch(() => new Map())

let misses = 0
const replay = replayFetch(store)
const countingReplay: FetchLike = async (input, init) => {
  const res = await replay(input, init)
  if (res.status === 599) misses++
  return res
}
const fetchFn: FetchLike = live ? recordingFetch(fetch, store) : countingReplay

// --- Pool --------------------------------------------------------------------------------

async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  rpm: number,
  f: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length)
  const interval = rpm > 0 ? 60_000 / rpm : 0
  let next = 0
  let last = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      if (interval) {
        const wait = Math.max(0, last + interval - Date.now())
        last = Date.now() + wait
        if (wait) await new Promise((r) => setTimeout(r, wait))
      }
      out[index] = await f(items[index] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, limit) }, worker))
  return out
}

interface VariantReport {
  name: string
  summary: unknown
  coverage: { answered: number; total: number }
  errors: Record<string, number>
  usage: UsageRow[]
  costUsd: number
  latencyMs: { p50: number; p95: number }
  details?: unknown[]
}

const reports: VariantReport[] = []

// --- Judge -------------------------------------------------------------------------------

async function runJudge(name: string): Promise<VariantReport> {
  const spec = parseJudgeSpec(name, thinking)
  const meter = createMeter()
  const errors: Record<string, number> = {}
  let outcomes: JudgeOutcome[]
  let details: unknown[] = []

  if (spec.kind === 'recorded') {
    outcomes = cases
      .filter((c) => c.recordedJev)
      .map((c) => ({
        label: c.label as 'yes' | 'no',
        probability: c.recordedJev?.probability ?? null,
        nature: (c.recordedJev?.nature ?? null) as JudgeOutcome['nature'],
      }))
  } else {
    const ai = createAi(judgeConfig(spec, credentials(live, process.env)), {
      fetch: fetchFn,
      sink: meter,
      spentToday: () => meter.spentUsd + spentBefore,
    })
    const judge = ai.judge()
    if (!judge) throw new Error('judge is off')
    let stop = false
    const results = await mapPool(
      cases,
      Number(values.concurrency),
      Number(values.rpm),
      async (c) => {
        if (stop) return null
        try {
          return await judge.judge({
            school: c.school,
            status: c.status,
            title: c.article.title,
            text: c.article.text,
            publishedDay: publishedDayOf(c),
          })
        } catch (e) {
          const kind = e instanceof AiError ? e.kind : 'error'
          errors[kind] = (errors[kind] ?? 0) + 1
          if (kind === 'budget' || kind === 'billing' || kind === 'auth') stop = true
          return null
        }
      },
    )
    outcomes = cases.map((c, i) => ({
      label: c.label as 'yes' | 'no',
      probability: results[i]?.probability ?? null,
      nature: results[i]?.nature ?? null,
    }))
    if (values.details)
      details = cases.map((c, i) => ({ id: c.id, label: c.label, verdict: results[i] ?? null }))
  }
  const usage = meter.drain()
  return finish(
    name,
    summarizeJudge(outcomes),
    outcomes.filter((o) => o.probability !== null).length,
    outcomes.length,
    errors,
    usage,
    details,
  )
}

// --- Extract -----------------------------------------------------------------------------

async function runExtract(name: string): Promise<VariantReport> {
  const spec = parseExtractSpec(name, thinking)
  const meter = createMeter()
  const errors: Record<string, number> = {}
  const ai = createAi(extractConfig(spec, credentials(live, process.env)), {
    fetch: fetchFn,
    sink: meter,
    spentToday: () => meter.spentUsd + spentBefore,
  })
  const { extractEvents } = await import('@manifeste/ai')
  const batchSize = Math.max(1, Number(values.batch))
  const batches: Case[][] = []
  for (let i = 0; i < cases.length; i += batchSize) batches.push(cases.slice(i, i + batchSize))
  let stop = false
  const per = await mapPool(
    batches,
    Number(values.concurrency),
    Number(values.rpm),
    async (batch) => {
      if (stop) return null
      try {
        const events = await extractEvents(
          ai.extractChain(),
          batch.map((c) => ({
            id: c.id,
            publishedAt: c.article.publishedAt,
            text: c.article.text,
          })),
          { prompt: spec.prompt, textChars: ai.config.tasks.extract.textChars },
        )
        return events
      } catch (e) {
        const kind = e instanceof AiError ? e.kind : 'error'
        errors[kind] = (errors[kind] ?? 0) + 1
        if (kind === 'budget' || kind === 'billing' || kind === 'auth') stop = true
        return null
      }
    },
  )
  const outcomes: ExtractOutcome[] = []
  const details: unknown[] = []
  batches.forEach((batch, i) => {
    const events = per[i]
    for (const c of batch) {
      const mine = (events ?? []).filter(
        (e) =>
          e.itemId === c.id && sameSchool(e, c.school) && meetsCertainty(e.certainty, minCertainty),
      )
      const kept = mine[0]
      outcomes.push({
        label: c.label as 'yes' | 'no',
        kept: Boolean(kept),
        status: kept?.status ?? null,
        expectedStatus: c.actualStatus ?? c.status,
        answered: events !== null && events !== undefined,
      })
      if (values.details) details.push({ id: c.id, label: c.label, kept: kept ?? null, events })
    }
  })
  const usage = meter.drain()
  return finish(
    name,
    summarizeExtract(outcomes),
    outcomes.filter((o) => o.answered).length,
    outcomes.length,
    errors,
    usage,
    details,
  )
}

function finish(
  name: string,
  summary: unknown,
  answered: number,
  total: number,
  errors: Record<string, number>,
  usage: UsageRow[],
  details: unknown[],
): VariantReport {
  const calls = usage.reduce((n, r) => n + r.calls, 0)
  const latency = usage.reduce((n, r) => n + r.latencyMsTotal, 0)
  return {
    name,
    summary,
    coverage: { answered, total },
    errors,
    usage,
    costUsd: usage.reduce((n, r) => n + r.costUsd, 0),
    // Per-call averages only: the meter keeps sums, so the percentiles use per-row means.
    latencyMs: {
      p50: calls ? Math.round(latency / calls) : 0,
      p95: Math.round(
        percentile(
          usage.map((r) => (r.calls ? r.latencyMsTotal / r.calls : 0)),
          95,
        ),
      ),
    },
    ...(details.length > 0 && { details }),
  }
}

let spentBefore = 0
for (const name of specs) {
  const report = task === 'judge' ? await runJudge(name) : await runExtract(name)
  spentBefore += report.costUsd
  if (live && spentBefore > maxUsd) console.error(`budget of ${maxUsd} USD exceeded, stopping`)
  reports.push(report)
  if (live && spentBefore > maxUsd) break
}

if (live) {
  mkdirSync(dirname(storePath), { recursive: true })
  writeFileSync(storePath, httpStoreToJson(store))
}

// --- Report ------------------------------------------------------------------------------

const pct = (n: number | null | undefined, digits = 1) =>
  n === null || n === undefined ? '–' : `${(n * 100).toFixed(digits)}`
const ratio = (r: { kept?: number; correct?: number; total: number }) =>
  r.total ? `${pct((r.kept ?? r.correct ?? 0) / r.total)} (${r.kept ?? r.correct}/${r.total})` : '–'

const lines: string[] = []
const row = (label: string, f: (r: VariantReport) => string) =>
  lines.push(`| ${label} | ${reports.map(f).join(' | ')} |`)
lines.push(`| metric | ${reports.map((r) => r.name).join(' | ')} |`)
lines.push(`|---|${reports.map(() => '---').join('|')}|`)
row('cases answered', (r) => `${r.coverage.answered}/${r.coverage.total}`)
if (task === 'judge') {
  type S = ReturnType<typeof summarizeJudge>
  row('AUC', (r) => (r.summary as S).auc?.toFixed(3) ?? '–')
  row('best threshold keeping ≥95% of true', (r) => {
    const best = (r.summary as S).best
    return best ? `${best.threshold} (drops ${best.falseRemoved}/${best.falseTotal} false)` : 'none'
  })
  row('"blockade" on false reports %', (r) => pct((r.summary as S).blockadeOnFalse))
  row('"blockade/closed" on true reports %', (r) => pct((r.summary as S).blockadeOrClosedOnTrue))
} else {
  type S = ReturnType<typeof summarizeExtract>
  row('true reports kept %', (r) => ratio((r.summary as S).trueKept))
  row('false reports kept % (lower is better)', (r) => ratio((r.summary as S).falseKept))
  row('status correct among kept true %', (r) => ratio((r.summary as S).statusCorrect))
}
row('cost USD (estimate)', (r) => r.costUsd.toFixed(4))
row('latency ms mean / p95 of rows', (r) => `${r.latencyMs.p50} / ${r.latencyMs.p95}`)
row('errors', (r) => (Object.keys(r.errors).length ? JSON.stringify(r.errors) : '–'))
console.log(`\n${lines.join('\n')}`)
if (!live && misses > 0)
  console.error(`\n${misses} requests had no recording (run with --live to record them)`)

mkdirSync(values.out ?? '', { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
writeFileSync(
  join(values.out ?? '', `${task}-${stamp}.json`),
  JSON.stringify(
    {
      task,
      mode: live ? 'live' : 'offline',
      at: new Date().toISOString(),
      cases: cases.length,
      withoutPage: missing.length,
      minCertainty,
      variants: reports.map(({ details: _details, ...r }) => r),
    },
    null,
    2,
  ),
)
if (values.details)
  writeFileSync(
    join(values.out ?? '', `${task}-${stamp}-cases.jsonl`),
    reports
      .flatMap((r) =>
        (r.details ?? []).map((d) => JSON.stringify({ variant: r.name, ...(d as object) })),
      )
      .join('\n'),
  )
