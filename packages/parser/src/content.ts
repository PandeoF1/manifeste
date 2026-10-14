/**
 * The article text of a page: where the body is, and which of its blocks are article.
 *
 * Strategy, in order: a site rule, an `itemprop=articleBody`, the biggest `<article>`, the
 * `<main>`, then a Readability-style scoring of paragraphs. The first container that yields
 * enough text wins; if none does, the one with the most text.
 */
import { isFurniture } from './boilerplate.ts'
import { $, $$, attr, bodyOf, tagName, textOf, type Doc, type El } from './dom.ts'
import type { SiteRule } from './rules.ts'
import type { Block, Strategy } from './types.ts'

/** Enough text to call a container "the article". */
const ENOUGH_CHARS = 500
const MAX_CHARS = 40_000

const NOISE_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'iframe',
  'canvas',
  'form',
  'button',
  'select',
  'option',
  'input',
  'textarea',
  'nav',
  'aside',
  'footer',
  'dialog',
  'figure',
  'picture',
  'audio',
  'video',
])
const NOISE_ROLES = new Set([
  'navigation',
  'banner',
  'complementary',
  'contentinfo',
  'dialog',
  'alert',
  'search',
])
/** Class and id tokens of page furniture: matched on whole tokens or BEM parts, not substrings. */
const NOISE_TOKEN =
  /(^|[-_])(ad|ads|advert|advertisement|adslot|breadcrumbs?|comments?|commentaires?|cookies?|consent|disqus|newsletter|outbrain|paywall|popin|popup|promo|recommend(ed|ations?)?|related|share|sharing|sidebar|social|sponsor(ed)?|subscribe|subscription|taboola|toolbar|widget)([-_]|$)/i

function selfNoise(el: El): boolean {
  if (NOISE_TAGS.has(tagName(el))) return true
  if ('hidden' in el.attribs || attr(el, 'aria-hidden') === 'true') return true
  const role = attr(el, 'role')
  if (role && NOISE_ROLES.has(role)) return true
  const tokens = `${attr(el, 'class')} ${attr(el, 'id')}`.split(/\s+/)
  return tokens.some((t) => t.length > 0 && NOISE_TOKEN.test(t))
}

/** Share of an element's text that sits inside links. */
function linkDensity(el: El): number {
  const total = textOf(el).length
  if (total === 0) return 0
  let linked = 0
  for (const a of $$('a', el)) linked += textOf(a).length
  return linked / total
}

export interface Harvest {
  blocks: Block[]
  chars: number
}

const BLOCK_SELECTOR = 'p, h2, h3, h4, li, blockquote'

function kindOf(tag: string): Block['kind'] {
  if (tag === 'li') return 'list-item'
  if (tag === 'blockquote') return 'quote'
  return tag === 'p' ? 'paragraph' : 'heading'
}

/** The blocks of a container, in reading order, without furniture. */
export function harvest(container: El, rules: SiteRule[]): Harvest {
  const removed = new Set<El>()
  for (const rule of rules)
    for (const selector of rule.remove ?? [])
      for (const el of $$(selector, container)) removed.add(el)

  // An element is noise when it, or any ancestor below the container, is. Walked upwards with a
  // loop (a deeply nested page would overflow a recursive version) and memoised for the siblings.
  const noise = new Map<El, boolean>()
  const isNoise = (el: El | null): boolean => {
    const path: El[] = []
    let result = false
    for (let cur = el; cur && cur !== container; cur = cur.parent as El | null) {
      const known = noise.get(cur)
      if (known !== undefined) {
        result = known
        break
      }
      if (removed.has(cur) || selfNoise(cur)) {
        noise.set(cur, true)
        result = true
        break
      }
      path.push(cur)
    }
    for (const p of path) noise.set(p, result)
    return result
  }

  const blocks: Block[] = []
  const seen = new Set<string>()
  let chars = 0
  for (const el of $$(BLOCK_SELECTOR, container)) {
    const tag = tagName(el)
    // Only leaf blocks: a list item or quote that holds paragraphs is read through them.
    if ((tag === 'li' || tag === 'blockquote') && $('p, li, blockquote', el)) continue
    if (isNoise(el)) continue
    const line = textOf(el)
    if (line.length < 3 || isFurniture(line)) continue
    if (linkDensity(el) > 0.8 && line.length < 120) continue
    const key = line.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    blocks.push({ kind: kindOf(tag), text: line })
    chars += line.length + 1
    if (chars >= MAX_CHARS) break
  }
  return { blocks, chars }
}

/** Readability-style scoring: paragraphs vote for their parent and grandparent. */
function scoredContainer(doc: Doc): El | null {
  const scores = new Map<El, number>()
  for (const p of $$('p', doc)) {
    const text = textOf(p)
    if (text.length < 25 || selfNoise(p)) continue
    const points = 1 + (text.match(/[,;]/g)?.length ?? 0) + Math.min(text.length / 100, 3)
    const parent = p.parent as El | null
    const grand = parent?.parent as El | null
    if (parent && parent.type === 'tag') scores.set(parent, (scores.get(parent) ?? 0) + points)
    if (grand && grand.type === 'tag') scores.set(grand, (scores.get(grand) ?? 0) + points / 2)
  }
  let best: El | null = null
  let bestScore = 0
  for (const [el, score] of scores) {
    if (selfNoise(el)) continue
    const adjusted = score * (1 - linkDensity(el))
    if (adjusted > bestScore) {
      best = el
      bestScore = adjusted
    }
  }
  return best
}

export interface Extraction extends Harvest {
  strategy: Strategy
}

export function extractContent(doc: Doc, rules: SiteRule[]): Extraction {
  const candidates: Array<{ strategy: Strategy; container: El | null }> = []
  for (const rule of rules) {
    for (const selector of rule.body ?? [])
      candidates.push({ strategy: 'site-rule', container: $(selector, doc) })
  }
  candidates.push({ strategy: 'article', container: $('[itemprop="articleBody" i]', doc) })

  // Pages list teasers as <article> too: the real one is the article with the most text.
  const articles = $$('article', doc).sort((a, b) => textOf(b).length - textOf(a).length)
  candidates.push({ strategy: 'article', container: articles[0] ?? null })
  candidates.push({ strategy: 'article', container: $('main, [role="main"]', doc) })
  candidates.push({ strategy: 'scored', container: scoredContainer(doc) })
  const body = bodyOf(doc)
  candidates.push({ strategy: 'body', container: 'name' in body ? (body as El) : null })

  let best: Extraction = { strategy: 'none', blocks: [], chars: 0 }
  for (const { strategy, container } of candidates) {
    if (!container) continue
    const found = harvest(container, rules)
    if (found.chars >= ENOUGH_CHARS) return { ...found, strategy }
    if (found.chars > best.chars) best = { ...found, strategy }
  }
  return best
}
