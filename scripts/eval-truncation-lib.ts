// Banc d'essai « texte plus court » : fonctions pures, testées dans tests/eval-truncation.test.ts.
import {
  meetsCertainty,
  type Certainty,
  type ExtractedEvent,
} from '../supabase/functions/_shared/extraction.ts'

type Comparable = Pick<ExtractedEvent, 'school_name' | 'status'>

/** Nom comparable : sans accents ni mots génériques (« Lycée Victor-Hugo » = « victor hugo »). */
export function plainName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(
      /\b(lycee|lyceen\w*|lp|lgt|lpo|universite|fac|faculte|iut|college|cite scolaire|de|du|des|la|le|les|d|l|st|saint|sainte)\b/g,
      ' ',
    )
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Même fait : même statut et noms identiques ou l'un contenu dans l'autre (« Hugo » ⊂ « Victor Hugo »). */
export function sameEvent(a: Comparable, b: Comparable): boolean {
  if (a.status !== b.status) return false
  const x = plainName(a.school_name)
  const y = plainName(b.school_name)
  if (!x || !y) return true
  return x === y || x.includes(y) || y.includes(x)
}

/** Faits qui comptent : ceux qui deviendraient un signal (certitude suffisante). */
export function kept(events: ReadonlyArray<ExtractedEvent>, min: Certainty): ExtractedEvent[] {
  return events.filter((e) => meetsCertainty(e.certainty, min))
}

/** Faits de `base` absents de `other` (perdus) et faits de `other` absents de `base` (gagnés). */
export function diffEvents<T extends Comparable>(
  base: ReadonlyArray<T>,
  other: ReadonlyArray<T>,
): { lost: T[]; gained: T[] } {
  return {
    lost: base.filter((b) => !other.some((o) => sameEvent(b, o))),
    gained: other.filter((o) => !base.some((b) => sameEvent(b, o))),
  }
}

/**
 * Position approximative (en caractères) de la première mention du nom dans le texte, -1 si
 * introuvable : un fait perdu dont le nom apparaît après la coupure s'explique par la coupure.
 */
export function nameOffset(text: string, schoolName: string): number {
  const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  const key = plainName(schoolName)
  if (!key) return -1
  const tokens = key.split(' ').filter((t) => t.length > 2)
  const hay = norm(text)
  const positions = tokens.map((t) => hay.indexOf(t)).filter((p) => p >= 0)
  return positions.length ? Math.min(...positions) : -1
}

export interface ItemResult {
  url: string
  /** Longueur du texte complet envoyé (avant coupure). */
  length: number
  /** Le fait vient d'un article qui a donné un signal en production. */
  fromReports: boolean
  base: ExtractedEvent[]
  rerun: ExtractedEvent[]
  byCap: Record<number, ExtractedEvent[]>
}

export interface CapReport {
  cap: number
  /** Éléments plus longs que la coupure (les seuls dont l'entrée change). */
  affected: number
  baseEvents: number
  /** Faits perdus par la coupure, parmi les éléments touchés. */
  lost: number
  /** Faits que la relance identique de la référence perd aussi (bruit du modèle). */
  noiseLost: number
  /** Éléments à signal en production qui n'ont plus aucun fait. */
  reportItemsEmptied: number
  /** Faits perdus dont le nom n'apparaît qu'après la coupure : perte certaine due à la coupure. */
  lostBeyondCut: number
  gained: number
  /** Part du texte conservée sur les éléments touchés (économie d'entrée = 1 - part). */
  keptShare: number
  examples: Array<{ url: string; school_name: string; status: string; offset: number }>
}

export function reportForCap(
  cap: number,
  items: ReadonlyArray<ItemResult>,
  texts: ReadonlyMap<string, string>,
  min: Certainty,
): CapReport {
  const affected = items.filter((i) => i.length > cap && i.byCap[cap])
  let baseEvents = 0
  let lost = 0
  let noiseLost = 0
  let gained = 0
  let lostBeyondCut = 0
  let reportItemsEmptied = 0
  let before = 0
  let after = 0
  const examples: CapReport['examples'] = []
  for (const i of affected) {
    const base = kept(i.base, min)
    const cand = kept(i.byCap[cap] ?? [], min)
    const d = diffEvents(base, cand)
    baseEvents += base.length
    lost += d.lost.length
    gained += d.gained.length
    noiseLost += diffEvents(base, kept(i.rerun, min)).lost.length
    if (i.fromReports && base.length > 0 && cand.length === 0) reportItemsEmptied++
    before += i.length
    after += cap
    for (const e of d.lost) {
      const offset = nameOffset(texts.get(i.url) ?? '', e.school_name)
      if (offset >= cap) lostBeyondCut++
      if (examples.length < 15)
        examples.push({ url: i.url, school_name: e.school_name, status: e.status, offset })
    }
  }
  return {
    cap,
    affected: affected.length,
    baseEvents,
    lost,
    noiseLost,
    reportItemsEmptied,
    lostBeyondCut,
    gained,
    keptShare: before ? after / before : 1,
    examples,
  }
}

/** Coupure sûre : aucun fait perdu au-delà du bruit, et aucun élément à signal vidé. */
export function isSafe(r: CapReport): boolean {
  return r.lost <= r.noiseLost && r.reportItemsEmptied === 0 && r.lostBeyondCut === 0
}
