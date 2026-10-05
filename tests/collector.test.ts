import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  chunk,
  collectSource,
  collectSources,
  mapLimit,
  type CollectorDb,
  type NewReport,
  type NewUnmatched,
} from '@shared/collector.ts'
import type { ExtractedEvent } from '@shared/extraction.ts'
import type { SchoolCandidate } from '@shared/matching.ts'

const html = readFileSync(new URL('./fixtures/telegram.html', import.meta.url), 'utf8')
const fetchFn = vi.fn(async () => new Response(html, { status: 200 }))

function fakeDb(candidates: Record<string, SchoolCandidate[]>) {
  const seen = new Set<string>()
  const reports: NewReport[] = []
  const unmatched: NewUnmatched[] = []
  const runs: Array<string | null> = []
  const db: CollectorDb = {
    seenIds: async (_s, ids) => new Set(ids.filter((i) => seen.has(i))),
    markSeen: async (_s, ids) => void ids.forEach((i) => seen.add(i)),
    matchSchool: async (name) => candidates[name] ?? [],
    schoolsInCity: async (city) => (city === 'Hanches' ? [{ uai: '0280000A' }] : []),
    insertReport: async (r) => {
      if (reports.some((x) => x.source_url === r.source_url && x.school_uai === r.school_uai))
        return 'duplicate'
      reports.push(r)
      return 'inserted'
    },
    insertUnmatched: async (u) => void unmatched.push(u),
    recordRun: async (_s, e) => void runs.push(e),
  }
  return { db, seen, reports, unmatched, runs }
}

const source = {
  id: 'src-1',
  kind: 'telegram' as const,
  identifier: 'mobilycee',
  label: 'Mobilycée',
  source_type: 'collecteur' as const,
}
const now = new Date('2026-10-04T09:00:00Z')
const besancon: SchoolCandidate = {
  uai: '0000002B',
  name: 'Lycée Victor Hugo',
  city: 'Besançon',
  name_score: 1,
  city_score: 1,
  score: 1,
}

describe('collectSource', () => {
  it('fetch -> filtre -> IA -> matching -> report, puis déduplique au passage suivant', async () => {
    const { db, reports, seen, runs } = fakeDb({ 'Lycée Victor-Hugo': [besancon] })
    const extract = vi.fn(
      async (batch: ReadonlyArray<{ id: string }>): Promise<ExtractedEvent[]> => [
        {
          item_id: batch[0]?.id ?? '',
          school_name: 'Lycée Victor-Hugo',
          city: 'Besançon',
          status: 'bloque',
          observed_at: '2026-10-04T05:00:00Z',
          certainty: 'haute',
        },
      ],
    )

    const r1 = await collectSource(source, { db, fetchFn, extract, now })
    expect(r1).toMatchObject({
      fetched: 2,
      new_items: 2,
      relevant: 1,
      events: 1,
      reports: 1,
      error: null,
    })
    expect(reports[0]).toEqual({
      school_uai: '0000002B',
      status: 'bloque',
      source_type: 'collecteur',
      source_url: 'https://t.me/mobilycee/101',
      source_domain: 't.me',
      source_id: 'src-1',
      certainty: 'haute',
      observed_at: '2026-10-04T05:00:00.000Z',
    })
    expect(seen.size).toBe(2)
    expect(extract).toHaveBeenCalledTimes(1)

    const r2 = await collectSource(source, { db, fetchFn, extract, now })
    expect(r2).toMatchObject({ new_items: 0, reports: 0 })
    expect(extract).toHaveBeenCalledTimes(1)
    expect(runs).toEqual([null, null])
  })

  it('écarte les faibles certitudes et stocke les non-rattachés', async () => {
    const { db, reports, unmatched } = fakeDb({})
    const extract = async (batch: ReadonlyArray<{ id: string }>): Promise<ExtractedEvent[]> => [
      {
        item_id: batch[0]?.id ?? '',
        school_name: 'Lycée Inconnu',
        city: 'Nulle-Part',
        status: 'bloque',
        observed_at: null,
        certainty: 'haute',
      },
      {
        item_id: batch[0]?.id ?? '',
        school_name: 'Lycée Victor-Hugo',
        city: 'Besançon',
        status: 'bloque',
        observed_at: null,
        certainty: 'faible',
      },
    ]
    const r = await collectSource(source, { db, fetchFn, extract, now })
    expect(r).toMatchObject({ unmatched: 1, low_certainty: 1, reports: 0 })
    expect(reports).toHaveLength(0)
    expect(unmatched[0]).toMatchObject({
      school_name: 'Lycée Inconnu',
      observed_at: '2026-10-04T07:12:00.000Z',
    })
  })

  it("ne marque pas le lot traité si l'IA échoue", async () => {
    const { db, seen, runs } = fakeDb({})
    const extract = async () => {
      throw new Error('Gemini HTTP 503')
    }
    const r = await collectSource(source, { db, fetchFn, extract, now })
    expect(r.error).toBe('Gemini HTTP 503')
    expect([...seen]).toEqual(['mobilycee/103'])
    expect(runs).toEqual(['Gemini HTTP 503'])
  })

  it('ignore les éléments trop anciens', async () => {
    const { db } = fakeDb({})
    const extract = vi.fn(async () => [])
    const r = await collectSource(source, {
      db,
      fetchFn,
      extract,
      now: new Date('2026-10-10T00:00:00Z'),
    })
    expect(r.new_items).toBe(0)
    expect(extract).not.toHaveBeenCalled()
  })
})

describe('collectSources : plusieurs sources, lots communs', () => {
  it("regroupe les éléments de toutes les sources dans un seul appel à l'IA", async () => {
    const { db, reports } = fakeDb({ 'Lycée Victor-Hugo': [besancon] })
    const sourceB = { ...source, id: 'src-2', identifier: 'autre', label: 'Autre' }
    const extract = vi.fn(async (batch: ReadonlyArray<{ id: string }>): Promise<ExtractedEvent[]> =>
      batch.map((b) => ({
        item_id: b.id,
        school_name: 'Lycée Victor-Hugo',
        city: 'Besançon',
        status: 'bloque' as const,
        observed_at: null,
        certainty: 'haute' as const,
      })),
    )
    const results = await collectSources([source, sourceB], { db, fetchFn, extract, now })
    expect(extract).toHaveBeenCalledTimes(1)
    expect(extract.mock.calls[0]?.[0]).toHaveLength(2)
    // Les deux sources de test lisent la même page : le 2e signal est un doublon (même lien).
    expect(results.map((r) => [r.source_id, r.events, r.reports, r.duplicates, r.error])).toEqual([
      ['src-1', 1, 1, 0, null],
      ['src-2', 1, 0, 1, null],
    ])
    expect(reports.map((r) => r.source_id)).toEqual(['src-1'])
  })

  it("une source en erreur n'empêche pas les autres", async () => {
    const { db } = fakeDb({ 'Lycée Victor-Hugo': [besancon] })
    const failing = vi.fn(async (url: string) =>
      url.includes('cassee')
        ? new Response('', { status: 500 })
        : new Response(html, { status: 200 }),
    )
    const broken = { ...source, id: 'src-x', identifier: 'cassee', label: 'Cassée' }
    const extract = async (): Promise<ExtractedEvent[]> => []
    const results = await collectSources([broken, source], { db, fetchFn: failing, extract, now })
    expect(results[0]?.error).toMatch(/HTTP 500/)
    expect(results[1]).toMatchObject({ error: null, relevant: 1 })
  })

  it('mapLimit respecte la limite de concurrence et l’ordre', async () => {
    let active = 0
    let peak = 0
    const out = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      return n * 10
    })
    expect(out).toEqual([10, 20, 30, 40, 50])
    expect(peak).toBe(2)
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })
})

describe('nom générique et commune à lycée unique', () => {
  it('« Lycée de Hanches » est rattaché au seul lycée de la commune', async () => {
    const { db, reports, unmatched } = fakeDb({})
    const extract = async (batch: ReadonlyArray<{ id: string }>): Promise<ExtractedEvent[]> => [
      {
        item_id: batch[0]?.id ?? '',
        school_name: 'Lycée de Hanches',
        city: 'Hanches',
        status: 'bloque',
        observed_at: null,
        certainty: 'haute',
      },
      {
        item_id: batch[0]?.id ?? '',
        school_name: 'Lycée',
        city: 'Paris',
        status: 'bloque',
        observed_at: null,
        certainty: 'haute',
      },
    ]
    const r = await collectSource(source, { db, fetchFn, extract, now })
    expect(reports.map((x) => x.school_uai)).toEqual(['0280000A'])
    // Paris : plusieurs lycées (ou aucun connu) -> non rattaché, avec le domaine conservé.
    expect(unmatched).toEqual([
      expect.objectContaining({ school_name: 'Lycée', source_domain: 't.me' }),
    ])
    expect(r).toMatchObject({ reports: 1, unmatched: 1 })
  })
})
