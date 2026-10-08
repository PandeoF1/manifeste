// Banc d'essai du prompt « strict » : fonctions pures, testées dans tests/eval-prompt.test.ts.
import {
  meetsCertainty,
  type Certainty,
  type ExtractedEvent,
} from '../supabase/functions/_shared/extraction.ts'
import { plainName } from './eval-truncation-lib.ts'

/** CSV (guillemets doubles, retours à la ligne dans les champs) en lignes d'objets. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((v) => v !== '')) rows.push(row)
      row = []
    } else field += c
  }
  row.push(field)
  if (row.some((v) => v !== '')) rows.push(row)
  const [header, ...body] = rows
  if (!header) return []
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}

export interface Label {
  id: string
  url: string
  /** Jugement de l'audit manuel : l'article dit-il que l'établissement est bloqué ou fermé ? */
  blocage: 'oui' | 'non'
  typeErreur: string
}

/** Étiquettes exploitables : blocage « oui » ou « non » (les « incertain » et illisibles sont écartés). */
export function parseLabels(csv: string): Label[] {
  return parseCsv(csv).flatMap((r) => {
    const blocage = r.blocage
    const id = r.id
    const url = r.url_finale
    if (!id || !url || (blocage !== 'oui' && blocage !== 'non')) return []
    return [{ id, url, blocage, typeErreur: r.type_erreur ?? '' }]
  })
}

const tokens = (s: string) =>
  plainName(s)
    .split(' ')
    .filter((w) => w.length >= 4)

/** L'événement parle-t-il de cet établissement ? Noms identiques ou contenus, ou mot distinctif commun. */
export function eventMatchesSchool(
  event: Pick<ExtractedEvent, 'school_name' | 'city'>,
  school: { name: string; city: string },
): boolean {
  const a = plainName(event.school_name)
  const b = plainName(school.name)
  if (a && b && (a === b || a.includes(b) || b.includes(a))) return true
  const shared = tokens(event.school_name).some((w) => tokens(school.name).includes(w))
  const sameCity = Boolean(event.city) && plainName(event.city ?? '') === plainName(school.city)
  return shared && sameCity
}

/** Un fait de certitude suffisante vise-t-il cet établissement ? (il deviendrait un signal) */
export function hasKeptEvent(
  events: ReadonlyArray<ExtractedEvent>,
  school: { name: string; city: string },
  min: Certainty,
): boolean {
  return events.some((e) => meetsCertainty(e.certainty, min) && eventMatchesSchool(e, school))
}

export interface Outcome {
  label: 'oui' | 'non'
  base: boolean
  strict: boolean
}

export interface Summary {
  /** Signalements jugés faux par l'audit (blocage « non ») : le prompt strict doit les écarter. */
  faux: { n: number; baseKept: number; strictKept: number; removed: number }
  /** Signalements jugés vrais (blocage « oui ») : le prompt strict ne doit pas les perdre. */
  vrais: { n: number; baseKept: number; strictKept: number; lost: number }
}

export function summarize(outcomes: ReadonlyArray<Outcome>): Summary {
  const faux = outcomes.filter((o) => o.label === 'non')
  const vrais = outcomes.filter((o) => o.label === 'oui')
  return {
    faux: {
      n: faux.length,
      baseKept: faux.filter((o) => o.base).length,
      strictKept: faux.filter((o) => o.strict).length,
      removed: faux.filter((o) => o.base && !o.strict).length,
    },
    vrais: {
      n: vrais.length,
      baseKept: vrais.filter((o) => o.base).length,
      strictKept: vrais.filter((o) => o.strict).length,
      lost: vrais.filter((o) => o.base && !o.strict).length,
    },
  }
}
