/**
 * The few CSS selectors the parser needs, matched by a plain function (no compiled closures).
 *
 * Supported: comma lists, a tag name, `#id`, `.class` and `[attr]`, `[attr="v"]`, `[attr^="v"]`,
 * `[attr*="v"]`, each with an optional `i` flag, combined without spaces: `time[datetime].date`.
 * No combinators (descendant, child…): the parser looks for elements, then walks the tree itself.
 *
 * css-select would do all of this and more, but its compiled selector lists crash Bun's
 * JavaScriptCore on some real pages (reproduced on bun 1.4.2 and 1.4.3, fine under Node).
 */
import type { Element } from 'domhandler'

interface AttrTest {
  name: string
  op: '' | '=' | '^=' | '*='
  value: string
  insensitive: boolean
}

interface Compound {
  tag: string | null
  id: string | null
  classes: string[]
  attrs: AttrTest[]
}

const cache = new Map<string, Compound[]>()

/** Splits on commas that are outside brackets and quotes. */
function splitList(selector: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote = ''
  let current = ''
  for (const ch of selector) {
    if (quote) {
      if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '[') depth++
    else if (ch === ']') depth--
    if (ch === ',' && depth === 0 && !quote) {
      parts.push(current)
      current = ''
    } else current += ch
  }
  parts.push(current)
  return parts.map((p) => p.trim()).filter(Boolean)
}

const ATTR = /^\[\s*([\w:-]+)\s*(?:(\^=|\*=|=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+))\s*(i)?\s*)?\]/
const NAME = /^[\w-]+/

function parseCompound(source: string): Compound {
  const compound: Compound = { tag: null, id: null, classes: [], attrs: [] }
  let rest = source
  const tag = NAME.exec(rest)
  if (tag) {
    compound.tag = tag[0].toLowerCase()
    rest = rest.slice(tag[0].length)
  } else if (rest.startsWith('*')) rest = rest.slice(1)
  while (rest.length > 0) {
    if (rest[0] === '#' || rest[0] === '.') {
      const name = NAME.exec(rest.slice(1))
      if (!name) throw new Error(`bad selector: ${source}`)
      if (rest[0] === '#') compound.id = name[0]
      else compound.classes.push(name[0])
      rest = rest.slice(1 + name[0].length)
    } else if (rest[0] === '[') {
      const m = ATTR.exec(rest)
      if (!m) throw new Error(`bad selector: ${source}`)
      compound.attrs.push({
        name: (m[1] ?? '').toLowerCase(),
        op: (m[2] ?? '') as AttrTest['op'],
        value: m[3] ?? m[4] ?? m[5] ?? '',
        insensitive: m[6] === 'i',
      })
      rest = rest.slice(m[0].length)
    } else throw new Error(`unsupported selector (no combinators): ${source}`)
  }
  return compound
}

function compile(selector: string): Compound[] {
  let compiled = cache.get(selector)
  if (!compiled) {
    compiled = splitList(selector).map(parseCompound)
    cache.set(selector, compiled)
  }
  return compiled
}

function matchesCompound(el: Element, c: Compound): boolean {
  if (c.tag && el.name.toLowerCase() !== c.tag) return false
  if (c.id && el.attribs.id !== c.id) return false
  if (c.classes.length > 0) {
    const have = (el.attribs.class ?? '').split(/\s+/)
    if (!c.classes.every((k) => have.includes(k))) return false
  }
  for (const a of c.attrs) {
    const raw = el.attribs[a.name]
    if (raw === undefined) return false
    if (a.op === '') continue
    const [have, want] = a.insensitive ? [raw.toLowerCase(), a.value.toLowerCase()] : [raw, a.value]
    if (a.op === '=' && have !== want) return false
    if (a.op === '^=' && !have.startsWith(want)) return false
    if (a.op === '*=' && !have.includes(want)) return false
  }
  return true
}

/** Does the element match the selector (any of its comma-separated parts)? */
export function matches(el: Element, selector: string): boolean {
  return compile(selector).some((c) => matchesCompound(el, c))
}
