/**
 * Publication date of an article. Sources, most reliable first: JSON-LD, meta tags, a <time>
 * element of the article, and (last resort) a French date written in the page.
 */
import { $$, attr, clean, meta, type Doc } from './dom.ts'
import type { ArticleLd } from './json-ld.ts'
import type { DateSource } from './types.ts'

const META_KEYS = [
  'article:published_time',
  'og:article:published_time',
  'datePublished',
  'pubdate',
  'publishdate',
  'publish-date',
  'date',
  'dc.date.issued',
  'dcterms.created',
  'parsely-pub-date',
  'sailthru.date',
]

const MODIFIED_KEYS = ['article:modified_time', 'og:updated_time', 'dateModified', 'last-modified']

/** Dates before this are placeholders (1970, 2000…), not publications. */
const EARLIEST = Date.parse('2005-01-01')

function parse(raw: string, now: number): Date | null {
  const s = clean(raw)
  if (!s) return null
  // Epoch seconds or milliseconds.
  if (/^\d{10}$/.test(s)) return validate(new Date(Number(s) * 1000), now)
  if (/^\d{13}$/.test(s)) return validate(new Date(Number(s)), now)
  // "2026-10-05 10:30:00" without a zone: read as Paris time, which is what French sites mean.
  const naive = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/.exec(s)
  if (naive) return validate(new Date(`${naive[1]}T${naive[2]}${parisOffset(naive[1] ?? '')}`), now)
  return validate(new Date(s), now)
}

/** "+02:00" in summer, "+01:00" in winter (last Sunday of March to last Sunday of October). */
function parisOffset(day: string): string {
  const d = new Date(`${day}T12:00:00Z`)
  const year = d.getUTCFullYear()
  const lastSunday = (month: number) => {
    const last = new Date(Date.UTC(year, month + 1, 0, 1))
    return new Date(last.getTime() - last.getUTCDay() * 86_400_000)
  }
  return d >= lastSunday(2) && d < lastSunday(9) ? '+02:00' : '+01:00'
}

function validate(d: Date, now: number): Date | null {
  const t = d.getTime()
  if (Number.isNaN(t) || t < EARLIEST) return null
  // A date more than a day ahead is a scheduled event or a bug, not a publication.
  return t > now + 86_400_000 ? null : d
}

const FR_MONTHS =
  'janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre'
const MONTH_INDEX = (name: string) =>
  [
    'janvier',
    'fevrier',
    'mars',
    'avril',
    'mai',
    'juin',
    'juillet',
    'aout',
    'septembre',
    'octobre',
    'novembre',
    'decembre',
  ].indexOf(name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase())

/** "Publié le 05/10/2026 à 10h30", "5 octobre 2026 à 10:30": the visible date of a page. */
export function dateInText(text: string, now: number): Date | null {
  const labelled =
    /(?:publi[ée]+(?:\s+le)?|mis(?:e)? en ligne(?:\s+le)?|paru(?:e)?\s+le)\s*:?\s*(\d{1,2})(?:\/|\.|-)(\d{1,2})(?:\/|\.|-)(\d{4})(?:\s*(?:à|a|,)?\s*(\d{1,2})\s*[h:]\s*(\d{2})?)?/i.exec(
      text,
    )
  if (labelled) {
    const [, d, mo, y, h, mi] = labelled
    return build(Number(y), Number(mo) - 1, Number(d), Number(h ?? 0), Number(mi ?? 0), now)
  }
  const long = new RegExp(
    `(?:publi[ée]+(?:\\s+le)?|mis(?:e)? en ligne(?:\\s+le)?)\\s*:?\\s*(\\d{1,2})(?:er)?\\s+(${FR_MONTHS})\\s+(\\d{4})(?:\\s*(?:à|a|,)?\\s*(\\d{1,2})\\s*[h:]\\s*(\\d{2})?)?`,
    'i',
  ).exec(text)
  if (long) {
    const [, d, month, y, h, mi] = long
    return build(
      Number(y),
      MONTH_INDEX(month ?? ''),
      Number(d),
      Number(h ?? 0),
      Number(mi ?? 0),
      now,
    )
  }
  return null
}

function build(
  y: number,
  month: number,
  d: number,
  h: number,
  mi: number,
  now: number,
): Date | null {
  if (month < 0 || month > 11 || d < 1 || d > 31 || h > 23 || mi > 59) return null
  const day = `${String(y).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return validate(
    new Date(
      `${day}T${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:00${parisOffset(day)}`,
    ),
    now,
  )
}

export interface PublishedResult {
  publishedAt: Date | null
  source: DateSource | null
  modifiedAt: Date | null
}

export function readPublished(
  doc: Doc,
  ld: ArticleLd | null,
  visibleText: string,
  now: number,
): PublishedResult {
  let publishedAt: Date | null = null
  let source: DateSource | null = null
  const take = (date: Date | null, from: DateSource) => {
    if (!publishedAt && date) {
      publishedAt = date
      source = from
    }
  }
  take(parse(ld?.datePublished ?? '', now), 'json-ld')
  for (const key of META_KEYS) take(parse(meta(doc, key), now), 'meta')
  if (!publishedAt) {
    const times = $$(
      'time[datetime][itemprop="datePublished" i], time[datetime][pubdate], time.published, time.date, time[datetime]',
      doc,
    )
    for (const el of times) {
      take(parse(attr(el, 'datetime'), now), 'time-element')
      if (publishedAt) break
    }
  }
  take(dateInText(visibleText, now), 'visible-text')

  let modifiedAt = parse(ld?.dateModified ?? '', now)
  for (const key of MODIFIED_KEYS) if (!modifiedAt) modifiedAt = parse(meta(doc, key), now)
  return { publishedAt, source, modifiedAt }
}
