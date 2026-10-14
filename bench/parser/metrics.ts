/**
 * Scoring of a parser variant. All functions are pure and tested; the runner only feeds them.
 *
 * Reference data and what it means (see bench/README.md):
 * - mentions: (article, school) pairs from reports that cite the article. Recall is measured on
 *   the pairs where the school is mentioned somewhere in the raw page, so a wrong label cannot
 *   penalise a parser.
 * - dates: publication dates the production pipeline recorded for some articles.
 * - boilerplate: lines that repeat across many pages of one site (menus, "à lire aussi", share
 *   buttons) are not article content. The share of a variant's output made of such lines is its
 *   boilerplate rate. No hand labelling: the site itself shows what is repeated.
 */
import { lineKey } from './text.ts'

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index] ?? 0
}

export const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length

/** Lines that repeat across pages of a site, from the raw lines of every page. */
export interface BoilerplateIndex {
  /** domain -> normalised repeated lines */
  repeated: Map<string, Set<string>>
  /** domain -> number of pages it was computed from */
  pages: Map<string, number>
}

/** A domain needs this many pages before repetition says anything. */
export const MIN_PAGES_PER_DOMAIN = 8
const MIN_LINE_CHARS = 12

export function buildBoilerplateIndex(
  pages: ReadonlyArray<{ domain: string; lines: readonly string[] }>,
): BoilerplateIndex {
  const counts = new Map<string, Map<string, number>>()
  const sizes = new Map<string, number>()
  for (const page of pages) {
    sizes.set(page.domain, (sizes.get(page.domain) ?? 0) + 1)
    const seen = new Set<string>()
    for (const line of page.lines) {
      if (line.length < MIN_LINE_CHARS) continue
      seen.add(lineKey(line))
    }
    const perDomain = counts.get(page.domain) ?? new Map<string, number>()
    for (const key of seen) perDomain.set(key, (perDomain.get(key) ?? 0) + 1)
    counts.set(page.domain, perDomain)
  }
  const repeated = new Map<string, Set<string>>()
  for (const [domain, perDomain] of counts) {
    const n = sizes.get(domain) ?? 0
    if (n < MIN_PAGES_PER_DOMAIN) continue
    const threshold = Math.max(3, Math.ceil(0.04 * n))
    repeated.set(
      domain,
      new Set([...perDomain].filter(([, c]) => c >= threshold).map(([key]) => key)),
    )
  }
  return { repeated, pages: sizes }
}

/** Share (0..1) of the output characters that are boilerplate; null when the site has no reference. */
export function boilerplateShare(
  index: BoilerplateIndex,
  domain: string,
  outputLines: readonly string[],
): number | null {
  const reference = index.repeated.get(domain)
  if (!reference) return null
  let total = 0
  let boilerplate = 0
  for (const line of outputLines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    total += trimmed.length
    if (trimmed.length >= MIN_LINE_CHARS && reference.has(lineKey(trimmed)))
      boilerplate += trimmed.length
  }
  return total === 0 ? null : boilerplate / total
}

const parisDay = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(d)

export interface DateScore {
  found: boolean
  within1h: boolean
  sameDay: boolean
}

export function scoreDate(published: Date | null, expectedEpochSeconds: number): DateScore {
  if (!published || Number.isNaN(published.getTime()))
    return { found: false, within1h: false, sameDay: false }
  const expected = new Date(expectedEpochSeconds * 1000)
  return {
    found: true,
    within1h: Math.abs(published.getTime() - expected.getTime()) <= 3_600_000,
    sameDay: parisDay(published) === parisDay(expected),
  }
}

export interface PageRecord {
  hash: string
  domain: string
  ms: number
  chars: number
  boilerplate: number | null
  /** found: within the text the AI reads (first TEXT_CAP characters); foundFull: anywhere. */
  mentions: Array<{ reachable: boolean; found: boolean; foundFull: boolean }>
  date: DateScore | null
  blocked: string | null
}

const pct = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 1000) / 10)

export interface Summary {
  pages: number
  text: { meanChars: number; medianChars: number; emptyPct: number | null }
  mention: {
    pairs: number
    reachable: number
    found: number
    recallPct: number | null
    recallFullPct: number | null
  }
  date: {
    labelled: number
    foundPct: number | null
    sameDayPct: number | null
    within1hPct: number | null
  }
  boilerplate: { pagesScored: number; meanPct: number | null }
  latency: { p50Ms: number; p95Ms: number; totalSeconds: number }
  blocked: { flagged: number }
}

/** What the extraction prompt reads of an item (EXTRACTION_TEXT_CHARS in the legacy stack). */
export const TEXT_CAP = 6000

/** Pages with less text than this are counted as empty (no usable article). */
export const EMPTY_CHARS = 200

export function summarize(records: readonly PageRecord[]): Summary {
  const pairs = records.flatMap((r) => r.mentions)
  const reachable = pairs.filter((p) => p.reachable)
  const found = reachable.filter((p) => p.found)
  const foundFull = reachable.filter((p) => p.foundFull)
  const dated = records.filter((r) => r.date)
  const scored = records.filter((r) => r.boilerplate !== null)
  const chars = records.map((r) => r.chars)
  const times = records.map((r) => r.ms)
  return {
    pages: records.length,
    text: {
      meanChars: Math.round(mean(chars)),
      medianChars: percentile(chars, 50),
      emptyPct: pct(chars.filter((c) => c < EMPTY_CHARS).length, records.length),
    },
    mention: {
      pairs: pairs.length,
      reachable: reachable.length,
      found: found.length,
      recallPct: pct(found.length, reachable.length),
      recallFullPct: pct(foundFull.length, reachable.length),
    },
    date: {
      labelled: dated.length,
      foundPct: pct(dated.filter((r) => r.date?.found).length, dated.length),
      sameDayPct: pct(dated.filter((r) => r.date?.sameDay).length, dated.length),
      within1hPct: pct(dated.filter((r) => r.date?.within1h).length, dated.length),
    },
    boilerplate: {
      pagesScored: scored.length,
      meanPct: scored.length
        ? Math.round(mean(scored.map((r) => r.boilerplate ?? 0)) * 1000) / 10
        : null,
    },
    latency: {
      p50Ms: Math.round(percentile(times, 50) * 10) / 10,
      p95Ms: Math.round(percentile(times, 95) * 10) / 10,
      totalSeconds: Math.round(times.reduce((a, b) => a + b, 0) / 100) / 10,
    },
    blocked: { flagged: records.filter((r) => r.blocked).length },
  }
}
