import { join } from 'node:path'
import { parse } from '@manifeste/parser'
import { listCorpus, readPage } from '../parser/corpus.ts'

export type Verdict = 'yes' | 'no' | 'unsure'

/** One report the pipeline published, with a human verdict on whether the article supports it. */
export interface ReportLabel {
  id: string
  url: string
  /** First 10 hex characters of sha256(url): the corpus page. */
  page: string
  school: { name: string; city: string; department: string | null }
  status: 'blocked' | 'filtering' | 'lifted'
  observedAt: string | null
  label: Verdict
  errorType: string | null
  /** The status a human read in the article when it differs from the claimed one. */
  actualStatus: 'blocked' | 'filtering' | 'lifted' | 'none' | null
  quote: string
  origin: 'manual-audit' | 'judge-sample'
  /** Jev's answer when the sample was built, for the offline baseline. */
  recordedJev?: { probability: number; nature: string }
}

export async function loadReportLabels(
  path = join(import.meta.dir, '../datasets/ai/reports.jsonl'),
): Promise<ReportLabel[]> {
  const text = await Bun.file(path).text()
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ReportLabel)
}

/** A labelled report with the text of its article, read by the parser under test. */
export interface Case extends ReportLabel {
  article: { title: string; text: string; publishedAt: Date }
}

const parisDay = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(d)
export const publishedDayOf = (c: Pick<Case, 'article'>) => parisDay(c.article.publishedAt)

/**
 * Attaches the article to every label that has a saved page. Labels without a page are returned
 * apart so a report states its coverage instead of silently shrinking.
 */
export async function loadCases(
  corpusDir: string,
  labels: readonly ReportLabel[],
): Promise<{ cases: Case[]; missing: ReportLabel[] }> {
  const wanted = new Set(labels.map((l) => l.page))
  const entries = await listCorpus(corpusDir, { only: wanted, includeGoogleNews: true })
  const byHash = new Map(entries.map((e) => [e.hash, e]))
  const cases: Case[] = []
  const missing: ReportLabel[] = []
  let n = 0
  for (const label of labels) {
    const entry = byHash.get(label.page)
    if (!entry) {
      missing.push(label)
      continue
    }
    const page = parse((await readPage(entry)).html, entry.url)
    // Bun's JavaScriptCore has crashed on long DOM loops: collect now and then.
    if (++n % 50 === 0) Bun.gc(true)
    const publishedAt = page.publishedAt ?? (label.observedAt ? new Date(label.observedAt) : null)
    if (!publishedAt || !page.text) {
      missing.push(label)
      continue
    }
    cases.push({
      ...label,
      article: {
        title: page.title,
        text: [page.title, page.text].filter(Boolean).join('\n'),
        publishedAt,
      },
    })
  }
  return { cases, missing }
}
