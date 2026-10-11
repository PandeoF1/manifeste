/**
 * A thin layer over htmlparser2 (a small, fast tree of plain objects) and css-select. The first
 * version used linkedom, whose heavily linked nodes make Bun's garbage collector crash after a
 * few hundred pages (reproducible with `bun` 1.4.2 and 1.4.3, fine under Node); htmlparser2 parses
 * the whole corpus without trouble.
 */
import { isTag, isText, type AnyNode, type Document, type Element } from 'domhandler'
import { parseDocument } from 'htmlparser2'
import { matches } from './selector.ts'

export type Doc = Document
export type El = Element

/** Pages are cut here before parsing: nothing useful is in the last megabytes of a page. */
const MAX_HTML_CHARS = 2_500_000

export function loadDocument(html: string): Doc {
  return parseDocument(html.length > MAX_HTML_CHARS ? html.slice(0, MAX_HTML_CHARS) : html)
}

const childrenOf = (node: AnyNode): AnyNode[] => ('children' in node ? node.children : [])

/** Every element below `root` (not `root` itself) matching the selector, in document order. */
export function $$(selector: string, root: AnyNode): El[] {
  const found: El[] = []
  const walk = (node: AnyNode) => {
    for (const child of childrenOf(node)) {
      if (isTag(child)) {
        if (matches(child, selector)) found.push(child)
        walk(child)
      }
    }
  }
  walk(root)
  return found
}

/** The first element below `root` matching the selector, or null. */
export function $(selector: string, root: AnyNode): El | null {
  const walk = (node: AnyNode): El | null => {
    for (const child of childrenOf(node)) {
      if (!isTag(child)) continue
      if (matches(child, selector)) return child
      const inner = walk(child)
      if (inner) return inner
    }
    return null
  }
  return walk(root)
}

export const tagName = (el: El): string => el.name.toLowerCase()
export const attr = (el: El, name: string): string => el.attribs[name] ?? ''

/** Collapses whitespace (including non-breaking spaces) to single spaces. */
export function clean(text: string | null | undefined): string {
  return (text ?? '').replace(/[\s\u00a0\u2000-\u200b\u202f\u3000]+/g, ' ').trim()
}

/** Elements whose content is never text a reader sees. */
const INVISIBLE = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'head',
  'svg',
  'iframe',
  'canvas',
])
/** Elements that separate words even without a space in the source. */
const BREAKING = new Set([
  'p',
  'div',
  'li',
  'ul',
  'ol',
  'br',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'tr',
  'td',
  'th',
  'section',
  'article',
  'header',
  'footer',
  'blockquote',
  'figcaption',
  'dd',
  'dt',
  'main',
  'aside',
  'nav',
])
/** Deeper than this the tree is not markup anyone wrote for reading: stop. */
const MAX_DEPTH = 400

const memo = new WeakMap<AnyNode, string>()

/** The visible text of a node, whitespace collapsed (memoised: scoring asks repeatedly). */
export function textOf(node: AnyNode): string {
  const known = memo.get(node)
  if (known !== undefined) return known
  const parts: string[] = []
  const walk = (n: AnyNode, depth: number) => {
    if (depth > MAX_DEPTH) return
    if (isText(n)) {
      parts.push(n.data)
    } else if (isTag(n)) {
      const name = tagName(n)
      if (INVISIBLE.has(name)) return
      const breaking = BREAKING.has(name)
      if (breaking) parts.push(' ')
      for (const child of n.children) walk(child, depth + 1)
      if (breaking) parts.push(' ')
    } else if ('children' in n) {
      for (const child of n.children) walk(child, depth + 1)
    }
  }
  walk(node, 0)
  const text = clean(parts.join(''))
  memo.set(node, text)
  return text
}

/** Raw text content of a node, scripts included (JSON-LD lives in a script). */
export function rawText(node: AnyNode): string {
  if (isText(node)) return node.data
  return 'children' in node ? node.children.map(rawText).join('') : ''
}

export function meta(doc: Doc, key: string): string {
  for (const el of $$(
    `meta[property="${key}" i], meta[name="${key}" i], meta[itemprop="${key}" i]`,
    doc,
  )) {
    const content = clean(attr(el, 'content'))
    if (content) return content
  }
  return ''
}

export const titleOf = (doc: Doc): string => {
  const el = $('title', doc)
  return el ? clean(rawText(el)) : ''
}

export const langOf = (doc: Doc): string => {
  const el = $('html', doc)
  return el ? clean(attr(el, 'lang')) : ''
}

export const bodyOf = (doc: Doc): AnyNode => $('body', doc) ?? doc

/**
 * The visible text of a node with line breaks kept: `<br>` and block elements start a new line,
 * whitespace is collapsed inside each line. For posts, where the line structure carries meaning.
 */
export function linesOf(node: AnyNode): string {
  const lines: string[] = ['']
  const walk = (n: AnyNode, depth: number) => {
    if (depth > MAX_DEPTH) return
    if (isText(n)) {
      lines[lines.length - 1] += n.data
    } else if (isTag(n)) {
      const name = tagName(n)
      if (INVISIBLE.has(name)) return
      if (name === 'br') {
        lines.push('')
        return
      }
      const breaking = BREAKING.has(name)
      if (breaking) lines.push('')
      for (const child of n.children) walk(child, depth + 1)
      if (breaking) lines.push('')
    } else if ('children' in n) {
      for (const child of n.children) walk(child, depth + 1)
    }
  }
  walk(node, 0)
  return lines.map(clean).filter(Boolean).join('\n')
}
