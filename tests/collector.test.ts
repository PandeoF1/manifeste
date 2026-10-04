import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  collectSource,
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
