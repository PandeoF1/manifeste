import { describe, expect, it } from 'vitest'
import type { ExtractedEvent } from '@shared/extraction.ts'
import {
  diffEvents,
  isSafe,
  nameOffset,
  plainName,
  reportForCap,
  sameEvent,
  type ItemResult,
} from '../scripts/eval-truncation-lib.ts'

const ev = (
  school_name: string,
  status: ExtractedEvent['status'] = 'bloque',
  certainty: ExtractedEvent['certainty'] = 'haute',
): ExtractedEvent => ({
  item_id: '0',
  school_name,
  city: null,
  status,
  observed_at: null,
  certainty,
})

describe('comparaison des faits', () => {
  it('reconnaît un même établissement malgré les variantes de nom', () => {
    expect(plainName('Lycée Victor-Hugo')).toBe('victor hugo')
    expect(sameEvent(ev('Lycée Victor-Hugo'), ev('Victor Hugo'))).toBe(true)
    expect(sameEvent(ev('Lycée Hugo'), ev('Lycée Victor-Hugo'))).toBe(true)
    expect(sameEvent(ev('Lycée Pasteur'), ev('Lycée Victor-Hugo'))).toBe(false)
  })

  it('distingue le statut', () => {
    expect(sameEvent(ev('Lycée Pasteur', 'bloque'), ev('Lycée Pasteur', 'leve'))).toBe(false)
  })

  it('liste les faits perdus et gagnés', () => {
    const base = [ev('Lycée Pasteur'), ev('Lycée Carnot')]
    const cand = [ev('Lycée Pasteur'), ev('Lycée Ampère')]
    const d = diffEvents(base, cand)
    expect(d.lost.map((e) => e.school_name)).toEqual(['Lycée Carnot'])
    expect(d.gained.map((e) => e.school_name)).toEqual(['Lycée Ampère'])
  })
})

describe('nameOffset', () => {
  it('situe la première mention du nom, sans tenir compte des accents', () => {
    const text = 'x'.repeat(100) + ' blocus au lycée Joséphine-Baker'
    expect(nameOffset(text, 'Lycée Joséphine-Baker')).toBeGreaterThanOrEqual(100)
    expect(nameOffset('rien', 'Lycée Pasteur')).toBe(-1)
  })
})

describe('rapport par coupure', () => {
  const texts = new Map([
    ['https://a.fr/1', 'a'.repeat(3000) + ' lycée Carnot bloqué'],
    ['https://a.fr/2', 'b'.repeat(3000)],
  ])
  const item = (url: string, over: Partial<ItemResult>): ItemResult => ({
    url,
    length: (texts.get(url) ?? '').length,
    fromReports: true,
    base: [],
    rerun: [],
    byCap: {},
    ...over,
  })

  it('compte une perte due à la coupure, et vide un article à signal', () => {
    const items = [
      item('https://a.fr/1', {
        base: [ev('Lycée Carnot')],
        rerun: [ev('Lycée Carnot')],
        byCap: { 2000: [] },
      }),
    ]
    const r = reportForCap(2000, items, texts, 'moyenne')
    expect(r).toMatchObject({
      affected: 1,
      baseEvents: 1,
      lost: 1,
      noiseLost: 0,
      reportItemsEmptied: 1,
      lostBeyondCut: 1,
    })
    expect(isSafe(r)).toBe(false)
  })

  it('ne tient pas compte des articles plus courts que la coupure', () => {
    const items = [
      item('https://a.fr/2', { length: 1500, base: [ev('Lycée Pasteur')], byCap: { 2000: [] } }),
    ]
    expect(reportForCap(2000, items, texts, 'moyenne').affected).toBe(0)
  })

  it('juge sûre une coupure sans perte au-delà du bruit', () => {
    const items = [
      item('https://a.fr/1', {
        base: [ev('Lycée Carnot')],
        rerun: [ev('Lycée Carnot')],
        byCap: { 2000: [ev('Lycée Carnot')] },
      }),
    ]
    const r = reportForCap(2000, items, texts, 'moyenne')
    expect(r.keptShare).toBeCloseTo(2000 / 3020, 2)
    expect(isSafe(r)).toBe(true)
  })

  it('ignore les faits de certitude faible', () => {
    const items = [
      item('https://a.fr/1', {
        base: [ev('Lycée Carnot', 'bloque', 'faible')],
        byCap: { 2000: [] },
      }),
    ]
    expect(reportForCap(2000, items, texts, 'moyenne').baseEvents).toBe(0)
  })
})
