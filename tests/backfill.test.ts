import { describe, expect, it } from 'vitest'
import type { SourceRunResult } from '../supabase/functions/_shared/collector.ts'
import {
  dayFeedUrl,
  dayRange,
  fromQueueRow,
  isQuotaExhausted,
  presetQueries,
  regionalQueries,
  REGIONS,
  settle,
  toQueueRow,
} from '../scripts/backfill-lib.ts'

function result(items: SourceRunResult['items']): SourceRunResult {
  return {
    source_id: 's',
    label: 'Rattrapage',
    fetched: 0,
    new_items: 0,
    relevant: 0,
    events: 0,
    reports: 0,
    duplicates: 0,
    unmatched: 0,
    low_certainty: 0,
    error: null,
    items,
  }
}

describe('dayRange', () => {
  it('liste les jours inclus, mois à cheval', () => {
    expect(dayRange('2026-09-29', '2026-10-02')).toEqual([
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
    ])
  })
  it('refuse une plage inversée ou une date mal formée', () => {
    expect(() => dayRange('2026-10-02', '2026-10-01')).toThrow()
    expect(() => dayRange('14/09/2026', '2026-10-01')).toThrow()
  })
})

describe('dayFeedUrl', () => {
  it('limite la recherche à la journée', () => {
    const url = new URL(dayFeedUrl('"blocus" lycée', '2026-09-30'))
    expect(url.searchParams.get('q')).toBe('"blocus" lycée after:2026-09-30 before:2026-10-01')
    expect(url.searchParams.get('ceid')).toBe('FR:fr')
  })
})

describe('presetQueries', () => {
  it('reprend les requêtes Google Actualités des préréglages sans « when:1d »', () => {
    const queries = presetQueries()
    expect(queries).toContain('"blocus" lycée')
    expect(queries).toContain('lycée bloqué')
    expect(queries.every((q) => !q.includes('when:'))).toBe(true)
    expect(new Set(queries).size).toBe(queries.length)
  })
})

describe('ligne de file', () => {
  it('aller-retour sans perte', () => {
    const item = {
      externalId: 'CBMi123',
      url: 'https://news.google.com/rss/articles/CBMi123?oc=5',
      text: 'Blocus au lycée Jean-Jaurès - Le Parisien',
      publishedAt: new Date('2026-09-30T07:12:00Z'),
      publisherDomain: 'leparisien.fr',
    }
    const row = toQueueRow(item, 'lycée bloqué')
    expect(row.query).toBe('lycée bloqué')
    expect(fromQueueRow(row)).toEqual(item)
  })
})

describe('settle', () => {
  it('classe chaque article : traité, ou à reprendre en cas d’erreur ou d’absence', () => {
    const s = settle(
      ['a', 'b', 'c', 'd'],
      [
        result([
          { external_id: 'a', url: 'u', outcome: 'rattache' },
          { external_id: 'a', url: 'u', outcome: 'non_rattache' },
          { external_id: 'b', url: 'u', outcome: 'aucun_fait' },
          { external_id: 'c', url: 'u', outcome: 'erreur', detail: 'IA : HTTP 429' },
        ]),
      ],
    )
    expect(s.get('a')).toEqual({ kind: 'done', outcome: 'rattache,non_rattache' })
    expect(s.get('b')).toEqual({ kind: 'done', outcome: 'aucun_fait' })
    expect(s.get('c')).toEqual({ kind: 'retry', error: 'IA : HTTP 429' })
    expect(s.get('d')).toEqual({ kind: 'retry', error: 'non traité' })
  })
})

describe('isQuotaExhausted', () => {
  it('reconnaît un quota épuisé', () => {
    expect(isQuotaExhausted('gemini-3.5-flash HTTP 429 : Resource has been exhausted')).toBe(true)
    expect(isQuotaExhausted('gemini HTTP 503 : overloaded')).toBe(false)
  })
})

describe('regionalQueries', () => {
  it('décline une requête saturée par région', () => {
    const q = regionalQueries('lycée bloqué')
    expect(q).toHaveLength(REGIONS.length)
    expect(q).toContain('lycée bloqué "Bretagne"')
  })
})
