import { describe, expect, it } from 'vitest'
import {
  eventMatchesSchool,
  hasKeptEvent,
  natureOf,
  parseCsv,
  parseLabels,
  summarize,
  summarizeNature,
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

describe('nature des faits', () => {
  const school = { name: 'Lycée Victor Hugo', city: 'Besançon' }
  const withNature = (nature: ExtractedEvent['nature'], certainty: ExtractedEvent['certainty']) =>
    ({ ...ev('Lycée Victor-Hugo', 'Besançon', certainty), nature }) as ExtractedEvent

  it('« blocage » l’emporte quand plusieurs faits visent le même établissement', () => {
    const events = [withNature('ferme', 'haute'), withNature('blocage', 'moyenne')]
    expect(natureOf(events, school, 'moyenne')).toBe('blocage')
  })
  it('sans nature donnée, c’est « blocage » (comportement actuel)', () => {
    expect(natureOf([ev('Lycée Victor-Hugo', 'Besançon', 'haute')], school, 'moyenne')).toBe(
      'blocage',
    )
  })
  it('null si aucun fait de certitude suffisante', () => {
    expect(natureOf([withNature('blocage', 'faible')], school, 'moyenne')).toBeNull()
    expect(natureOf([], school, 'moyenne')).toBeNull()
  })
  it('compte les vrais mal classés et les faux séparés', () => {
    const s = summarizeNature([
      { label: 'oui', base: true, nature: 'blocage' },
      { label: 'oui', base: true, nature: 'ferme' },
      { label: 'oui', base: false, nature: null },
      { label: 'non', base: true, nature: 'rassemblement' },
      { label: 'non', base: true, nature: 'blocage' },
    ])
    expect(s.vrais).toEqual({ n: 3, blocage: 1, ferme: 1, rassemblement: 0, absent: 1 })
    expect(s.faux).toEqual({ n: 2, blocage: 1, ferme: 0, rassemblement: 1, absent: 0 })
  })
})
