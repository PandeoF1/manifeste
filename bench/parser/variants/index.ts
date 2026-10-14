import { branch } from './branch.ts'
import { legacy } from './legacy.ts'
import type { ParserVariant } from './types.ts'

/** The parser under development (packages/parser), loaded lazily so baselines run without it. */
const v2: ParserVariant = {
  name: 'v2',
  description: 'packages/parser (DOM based, JSON-LD, site rules, bot-wall detection)',
  async parse(html, url) {
    const { parse } = await import('@manifeste/parser')
    const page = parse(html, url)
    return {
      // What the pipeline hands the AI: title, summary, then the article.
      text: [page.title, page.description, page.text].filter(Boolean).join('\n'),
      title: page.title,
      publishedAt: page.publishedAt,
      blocked: page.blocked ? { reason: page.blocked.reason } : null,
    }
  },
}

export const VARIANTS: Record<string, ParserVariant> = { legacy, branch, v2 }
