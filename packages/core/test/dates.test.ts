import { describe, expect, test } from 'bun:test'
import {
  isParisWeekend,
  isWeekendLyceeBlockade,
  parisMidnight,
  resolveObservation,
} from '../src/dates.ts'

const at = (extracted: string | null, published: Date) =>
  resolveObservation(extracted, published).at

describe('resolveObservation', () => {
  const published = new Date('2026-10-04T10:00:00Z')

  test('keeps a plausible extracted date', () => {
    expect(at('2026-10-04T07:00:00+02:00', published).toISOString()).toBe(
      '2026-10-04T05:00:00.000Z',
    )
  })

  test('falls back to publication when missing, invalid, too old or too far ahead', () => {
    for (const v of [null, 'demain', '2026-09-01T10:00:00Z', '2026-10-09T10:00:00Z']) {
      expect(at(v, published)).toEqual(published)
    }
  })

  test('refuses a later hour on the same day', () => {
    expect(at('2026-10-04T13:00:00Z', published)).toEqual(published)
  })

  test('keeps the announced day of a fact planned for another day', () => {
    const sundayEvening = new Date('2026-10-04T17:06:00Z')
    expect(at('2026-10-05T09:30:00+02:00', sundayEvening).toISOString()).toBe(
      '2026-10-05T07:30:00.000Z',
    )
  })

  test('an announced day without an hour means 8 am in Paris', () => {
    const sundayEvening = new Date('2026-10-04T17:06:00Z')
    for (const v of ['2026-10-05', '2026-10-05T00:00:00', '2026-10-05T00:00:00+02:00']) {
      expect(at(v, sundayEvening).toISOString()).toBe('2026-10-05T06:00:00.000Z')
    }
  })

  test('handles winter time', () => {
    expect(at('2026-12-07', new Date('2026-12-05T12:00:00Z')).toISOString()).toBe(
      '2026-12-07T07:00:00.000Z',
    )
  })

  test('a day alone on the day itself: 8 am, or the publication when earlier', () => {
    const afternoon = new Date('2026-10-05T12:00:00Z')
    expect(at('2026-10-05', afternoon).toISOString()).toBe('2026-10-05T06:00:00.000Z')
    const early = new Date('2026-10-05T05:00:00Z')
    expect(at('2026-10-05', early)).toEqual(early)
  })

  test('a day alone published at night is announced for 8 am', () => {
    const night = new Date('2026-10-08T22:12:00Z') // Friday 9 October, 0:12 in Paris
    expect(resolveObservation('2026-10-09', night)).toEqual({
      at: new Date('2026-10-09T06:00:00.000Z'),
      basis: 'announced',
    })
    const dawn = new Date('2026-10-09T05:30:00Z')
    expect(resolveObservation('2026-10-09', dawn)).toEqual({ at: dawn, basis: 'extracted' })
  })

  test('a past day: 8 am that day, unless more than 7 days back (stale)', () => {
    const p = new Date('2026-10-06T12:00:00Z')
    expect(at('2026-10-02', p).toISOString()).toBe('2026-10-02T06:00:00.000Z')
    expect(at('2026-09-20', p)).toEqual(p)
    expect(resolveObservation('2026-09-20', p).basis).toBe('stale')
    expect(resolveObservation('2020-11-04T10:00:00Z', p).basis).toBe('stale')
  })

  test('tells where the date comes from', () => {
    const sunday = new Date('2026-10-04T17:06:00Z')
    expect(resolveObservation('2026-10-04T09:00:00+02:00', sunday).basis).toBe('extracted')
    expect(resolveObservation('2026-10-05', sunday).basis).toBe('announced')
    expect(resolveObservation('demain', sunday).basis).toBe('published')
    expect(resolveObservation(null, sunday).basis).toBe('published')
  })
})

describe('weekend rule', () => {
  test('Saturday and Sunday in Paris, across midnight UTC', () => {
    expect(isParisWeekend(new Date('2026-10-10T10:00:00Z'))).toBe(true)
    expect(isParisWeekend(new Date('2026-10-11T21:30:00Z'))).toBe(true) // Sunday 23:30 in Paris
    expect(isParisWeekend(new Date('2026-10-11T22:30:00Z'))).toBe(false) // Monday 0:30 in Paris
  })

  test('only blocked lycées are dropped at weekends', () => {
    const saturday = new Date('2026-10-10T08:00:00Z')
    expect(isWeekendLyceeBlockade('blocked', 'secondary', saturday)).toBe(true)
    expect(isWeekendLyceeBlockade('blocked', 'higher', saturday)).toBe(false)
    expect(isWeekendLyceeBlockade('lifted', 'secondary', saturday)).toBe(false)
    expect(isWeekendLyceeBlockade('blocked', 'secondary', new Date('2026-10-12T08:00:00Z'))).toBe(
      false,
    )
  })
})

describe('parisMidnight', () => {
  test('summer and winter offsets', () => {
    expect(parisMidnight('2026-09-14').toISOString()).toBe('2026-09-13T22:00:00.000Z')
    expect(parisMidnight('2026-12-01').toISOString()).toBe('2026-11-30T23:00:00.000Z')
  })
})
