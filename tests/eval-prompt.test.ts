import { describe, expect, it } from 'vitest'
import {
  eventMatchesSchool,
  hasKeptEvent,
  parseCsv,
  parseLabels,
  summarize,
} from '../scripts/eval-prompt-lib'
import type { ExtractedEvent } from '../supabase/functions/_shared/extraction'

const ev = (school_name: string, city: string | null, certainty: ExtractedEvent['certainty']) =>
  ({
    item_id: '0',
    school_name,
    city,
    status: 'bloque',
    observed_at: null,
    certainty,
  }) as ExtractedEvent

describe('parseCsv / parseLabels', () => {
  const csv =
    'id,url_finale,blocage,type_erreur,citation\n' +
    'a,https://x.fr/1,oui,,"Un lycée, bloqué ""ce lundi"""\n' +
    'b,https://x.fr/2,non,incident,"deux\nlignes"\n' +
    'c,https://x.fr/3,incertain,,\n' +
    'd,,oui,,\n'
  it('lit les champs entre guillemets et multilignes', () => {
    const rows = parseCsv(csv)
    expect(rows).toHaveLength(4)
    expect(rows[0]?.citation).toBe('Un lycée, bloqué "ce lundi"')
    expect(rows[1]?.citation).toBe('deux\nlignes')
  })
  it('ne garde que les jugements oui / non avec une adresse', () => {
    expect(parseLabels(csv)).toEqual([
      { id: 'a', url: 'https://x.fr/1', blocage: 'oui', typeErreur: '' },
      { id: 'b', url: 'https://x.fr/2', blocage: 'non', typeErreur: 'incident' },
    ])
  })
})

describe('eventMatchesSchool / hasKeptEvent', () => {
  const school = { name: 'Lycée polyvalent Emmanuel Mounier', city: 'Grenoble' }
  it('reconnaît un nom court et refuse un autre établissement', () => {
    expect(eventMatchesSchool(ev('Lycée Mounier', 'Grenoble', 'haute'), school)).toBe(true)
    expect(eventMatchesSchool(ev('Lycée Champollion', 'Grenoble', 'haute'), school)).toBe(false)
  })
  it('ignore les faits sous le seuil de certitude', () => {
    const events = [ev('Lycée Mounier', 'Grenoble', 'faible')]
    expect(hasKeptEvent(events, school, 'moyenne')).toBe(false)
    expect(hasKeptEvent([ev('Lycée Mounier', 'Grenoble', 'moyenne')], school, 'moyenne')).toBe(true)
  })
})

describe('summarize', () => {
  it('compte les faux écartés et les vrais perdus', () => {
    const s = summarize([
      { label: 'non', base: true, strict: false },
      { label: 'non', base: true, strict: true },
      { label: 'oui', base: true, strict: true },
      { label: 'oui', base: true, strict: false },
    ])
    expect(s.faux).toEqual({ n: 2, baseKept: 2, strictKept: 1, removed: 1 })
    expect(s.vrais).toEqual({ n: 2, baseKept: 2, strictKept: 1, lost: 1 })
  })
})
