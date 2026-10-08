// Logique pure de l'audit des signalements (voir scripts/audit-reports.ts), testée dans
// tests/audit-reports.test.ts. Elle relit l'article source d'un signalement et vérifie deux choses :
// que l'établissement y est cité, et que le jour retenu est celui que dit le texte.

const WEEKDAYS: Record<string, number> = {
  lundi: 1,
  mardi: 2,
  mercredi: 3,
  jeudi: 4,
  vendredi: 5,
  samedi: 6,
  dimanche: 0,
}
const MONTHS: Record<string, number> = { septembre: 9, octobre: 10, novembre: 11 }
const GENERIC = new Set(
  'lycee polyvalent professionnel professionnelle technologique general generale metiers prive public universite institut ecole saint sainte'.split(
    ' ',
  ),
)

export function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&eacute;/g, 'é')
    .replace(/&egrave;/g, 'è')
    .replace(/&agrave;/g, 'à')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
}

export interface ParsedArticle {
  title: string
  /** Date de publication lue dans la page (ISO), si trouvée. */
  published: string | null
  text: string
}

/** Titre, date de publication et paragraphes d'une page d'article. */
export function parseArticle(html: string): ParsedArticle {
  const grab = (re: RegExp) => re.exec(html)?.[1]
  const title = decodeEntities(grab(/<title[^>]*>([\s\S]*?)<\/title>/i) ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  const published =
    grab(/property=["']article:published_time["'][^>]*content=["']([^"']+)/i) ??
    grab(/content=["']([^"']+)["'][^>]*property=["']article:published_time["']/i) ??
    grab(/"datePublished"\s*:\s*"([^"]+)"/i) ??
    grab(/<time[^>]*datetime=["']([^"']+)/i) ??
    null
  const body = html.replace(
    /<(script|style|nav|footer|aside|header|form|noscript|svg)[\s\S]*?<\/\1>/gi,
    ' ',
  )
  const paragraphs = [...body.matchAll(/<(p|li|h2|h3)[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((m) =>
      decodeEntities((m[2] ?? '').replace(/<[^>]+>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((t) => t.length > 25)
  return { title, published, text: paragraphs.join('\n').slice(0, 20_000) }
}

export type Mention = 'nom' | 'ville' | 'non'

/** L'établissement est-il cité ? « nom » : la moitié des mots distinctifs du nom au moins. */
export function schoolMention(text: string, school: { name: string; city: string }): Mention {
  const words = new Set(norm(text).match(/[a-z0-9]+/g) ?? [])
  const nameWords = (norm(school.name).match(/[a-z]{3,}/g) ?? []).filter((w) => !GENERIC.has(w))
  const cityWords = (norm(school.city).match(/[a-z]{3,}/g) ?? []).filter((w) => !GENERIC.has(w))
  const nameHit = nameWords.filter((w) => words.has(w)).length
  if (nameWords.length > 0 && nameHit / nameWords.length >= 0.5) return 'nom'
  if (cityWords.length > 0 && cityWords.every((w) => words.has(w))) return 'ville'
  return 'non'
}

/** Phrases du texte qui parlent de l'établissement (nom distinctif ou commune). */
export function sentencesAbout(text: string, school: { name: string; city: string }): string[] {
  const keys = [
    ...(norm(school.name).match(/[a-z]{5,}/g) ?? []).filter((w) => !GENERIC.has(w)),
    ...(norm(school.city).match(/[a-z]{4,}/g) ?? []),
  ]
  return text
    .split(/(?<=[.!?])\s+|\n/)
    .filter((st) => keys.some((k) => norm(st).includes(k)))
    .slice(0, 4)
}

const DAY_MS = 86_400_000
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10)

/**
 * Jours que le texte peut désigner, vus depuis le jour de publication (AAAA-MM-JJ) : un jour de
 * la semaine cité renvoie au plus récent passé, ou au prochain dans les 3 jours (annonce) ;
 * « 28 septembre », « hier » et « aujourd'hui » sont lus tels quels.
 */
export function dateCandidates(text: string, pubDay: string): Set<string> {
  const pub = Date.parse(`${pubDay}T12:00:00Z`)
  const pubWeekday = new Date(pub).getUTCDay()
  const t = norm(text)
  const out = new Set<string>()
  for (const m of t.matchAll(/\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/g)) {
    const w = WEEKDAYS[m[1] ?? '']
    if (w === undefined) continue
    out.add(isoDay(pub - ((pubWeekday - w + 7) % 7) * DAY_MS))
    const ahead = (w - pubWeekday + 7) % 7 || 7
    if (ahead <= 3) out.add(isoDay(pub + ahead * DAY_MS))
  }
  for (const m of t.matchAll(/\b(\d{1,2})(?:er)?\s+(septembre|octobre|novembre)\b/g)) {
    const month = MONTHS[m[2] ?? '']
    const day = Number(m[1])
    if (month && day >= 1 && day <= 31) {
      out.add(
        `${pubDay.slice(0, 4)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      )
    }
  }
  if (/\bhier\b/.test(t)) out.add(isoDay(pub - DAY_MS))
  if (/aujourd'?hui|ce matin|cet apres-midi|ce soir|ce jour/.test(t)) out.add(pubDay)
  return out
}

export type DateVerdict =
  | { kind: 'coherent' }
  | { kind: 'indetermine' }
  | { kind: 'incoherent'; gapDays: number; candidates: string[] }

/** Le jour retenu (AAAA-MM-JJ, Paris) est-il l'un de ceux que le texte désigne ? */
export function checkDate(observedDay: string, candidates: Set<string>): DateVerdict {
  if (candidates.size === 0) return { kind: 'indetermine' }
  if (candidates.has(observedDay)) return { kind: 'coherent' }
  const obs = Date.parse(`${observedDay}T12:00:00Z`)
  const gap = Math.min(
    ...[...candidates].map((c) => Math.abs(obs - Date.parse(`${c}T12:00:00Z`)) / DAY_MS),
  )
  return { kind: 'incoherent', gapDays: Math.round(gap), candidates: [...candidates].sort() }
}
