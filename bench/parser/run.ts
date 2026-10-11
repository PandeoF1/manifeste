/**
 * Scores parser variants on the saved pages.
 *
 *   bun bench/parser/run.ts --variants legacy,branch,v2 [--corpus ~/manifest-corpus] [--limit 300]
 *       [--labelled] [--out bench/results/parser] [--details]
 *
 * `--labelled` restricts the run to pages that have at least one label (fast, and what the
 * quality scores are computed on). Without it every page is parsed, which also measures latency
 * and empty pages on the whole corpus. Results land in `--out` as one JSON summary per run.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { mentionsSchool } from '@manifeste/core'
import { listCorpus, readPage, type Page } from './corpus.ts'
import { loadMentions, loadPublicationDates } from './datasets.ts'
import {
  boilerplateShare,
  buildBoilerplateIndex,
  scoreDate,
  summarize,
  TEXT_CAP,
  type PageRecord,
} from './metrics.ts'
import { naiveLines } from './text.ts'
import { VARIANTS } from './variants/index.ts'

const { values } = parseArgs({
  options: {
    variants: { type: 'string', default: 'legacy,branch' },
    corpus: { type: 'string', default: join(homedir(), 'manifest-corpus') },
    limit: { type: 'string' },
    labelled: { type: 'boolean', default: false },
    out: { type: 'string', default: join(import.meta.dir, '../results/parser') },
    details: { type: 'boolean', default: false },
  },
})

const variantNames = (values.variants ?? '').split(',').filter(Boolean)
for (const name of variantNames) if (!VARIANTS[name]) throw new Error(`unknown variant: ${name}`)

const [mentions, dates] = await Promise.all([loadMentions(), loadPublicationDates()])
const mentionsByPage = new Map<string, typeof mentions>()
for (const m of mentions)
  mentionsByPage.set(m.urlHash, [...(mentionsByPage.get(m.urlHash) ?? []), m])

// The reference for repeated lines always uses the whole corpus, whatever the run is limited to.
const everything = await listCorpus(values.corpus ?? '')
async function referenceLines(): Promise<Array<{ domain: string; lines: string[] }>> {
  const out = []
  for (const entry of everything)
    out.push({ domain: entry.domain, lines: naiveLines((await readPage(entry)).html) })
  return out
}
console.error(`reference: ${everything.length} pages`)
const boilerplateIndex = buildBoilerplateIndex(await referenceLines())

const only = values.labelled ? new Set([...mentionsByPage.keys(), ...dates.keys()]) : undefined
const entries = await listCorpus(values.corpus ?? '', {
  ...(only ? { only } : {}),
  ...(values.limit ? { limit: Number(values.limit) } : {}),
})
console.error(`scoring ${entries.length} pages with: ${variantNames.join(', ')}`)

const startedAt = new Date()
const runId = `${startedAt.toISOString().replace(/[:.]/g, '-')}`
const summaries: Record<string, ReturnType<typeof summarize>> = {}
const details: Record<string, PageRecord[]> = {}

for (const name of variantNames) {
  const variant = VARIANTS[name]
  if (!variant) continue
  const records: PageRecord[] = []
  for (const entry of entries) {
    const page: Page = await readPage(entry)
    const t0 = performance.now()
    let output
    try {
      output = await variant.parse(page.html, page.url)
    } catch (error) {
      console.error(
        `  ${name} failed on ${page.hash}: ${error instanceof Error ? error.message : error}`,
      )
      output = { text: '', title: '', publishedAt: null }
    }
    const ms = performance.now() - t0
    const raw = naiveLines(page.html).join('\n')
    const expected = dates.get(page.hash)
    records.push({
      hash: page.hash,
      domain: page.domain,
      ms,
      chars: output.text.length,
      boilerplate: boilerplateShare(boilerplateIndex, page.domain, output.text.split('\n')),
      mentions: (mentionsByPage.get(page.hash) ?? []).map((m) => {
        const school = { name: m.school, city: m.city }
        const strict = { strict: true }
        return {
          reachable: mentionsSchool(raw, school, strict),
          found: mentionsSchool(output.text.slice(0, TEXT_CAP), school, strict),
          foundFull: mentionsSchool(output.text, school, strict),
        }
      }),
      date: expected === undefined ? null : scoreDate(output.publishedAt, expected),
      blocked: output.blocked?.reason ?? null,
    })
  }
  summaries[name] = summarize(records)
  details[name] = records
}

const report = {
  runId,
  at: startedAt.toISOString(),
  corpus: { pages: entries.length, labelledOnly: values.labelled },
  variants: Object.fromEntries(variantNames.map((n) => [n, VARIANTS[n]?.description])),
  summaries,
}
mkdirSync(values.out ?? '.', { recursive: true })
writeFileSync(join(values.out ?? '.', `${runId}.json`), JSON.stringify(report, null, 2))
if (values.details)
  for (const [name, records] of Object.entries(details))
    writeFileSync(
      join(values.out ?? '.', `${runId}-${name}-pages.jsonl`),
      records.map((r) => JSON.stringify(r)).join('\n'),
    )

const row = (label: string, f: (s: ReturnType<typeof summarize>) => string) =>
  `| ${label} | ${variantNames.map((n) => f(summaries[n] as ReturnType<typeof summarize>)).join(' | ')} |`
console.log(
  `\n| metric | ${variantNames.join(' | ')} |\n|---|${variantNames.map(() => '---').join('|')}|`,
)
console.log(row('pages', (s) => String(s.pages)))
console.log(
  row(
    'mention recall % (first 6000 chars)',
    (s) => `${s.mention.recallPct} (${s.mention.found}/${s.mention.reachable})`,
  ),
)
console.log(row('mention recall % (whole text)', (s) => String(s.mention.recallFullPct)))
console.log(row('date found %', (s) => String(s.date.foundPct)))
console.log(row('date same day %', (s) => String(s.date.sameDayPct)))
console.log(row('date within 1 h %', (s) => String(s.date.within1hPct)))
console.log(row('boilerplate % of output', (s) => String(s.boilerplate.meanPct)))
console.log(row('median chars', (s) => String(s.text.medianChars)))
console.log(row('empty (<200 chars) %', (s) => String(s.text.emptyPct)))
console.log(row('latency p50 / p95 ms', (s) => `${s.latency.p50Ms} / ${s.latency.p95Ms}`))
console.log(row('flagged blocked', (s) => String(s.blocked.flagged)))
