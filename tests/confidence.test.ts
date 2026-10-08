import { describe, expect, it } from 'vitest'
import { CONFIRMED_MIN_SOURCES, sourceConfidence } from '@/lib/confidence'

describe('sourceConfidence', () => {
  it('confirme à partir de deux sources', () => {
    expect(sourceConfidence(2)).toMatchObject({
      level: 'confirme',
      label: 'Confirmé par 2 sources',
    })
    expect(sourceConfidence(7).label).toBe('Confirmé par 7 sources')
    expect(CONFIRMED_MIN_SOURCES).toBe(2)
  })
  it('une source reste une source unique, jamais « confirmée »', () => {
    expect(sourceConfidence(1)).toMatchObject({ level: 'unique', label: 'Source unique' })
  })
  it('sans source ou valeur invalide : inconnu', () => {
    for (const v of [0, -3, null, undefined, Number.NaN]) {
      expect(sourceConfidence(v).level).toBe('inconnu')
    }
  })
})
