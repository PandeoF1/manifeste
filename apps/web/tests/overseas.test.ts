import { describe, expect, it } from 'bun:test'
import { activeTerritories, territoryOf } from '@/lib/overseas'

const pt = (department: string | null, lat: number, lng: number) => ({ department, lat, lng })

describe('territoryOf', () => {
  it('maps overseas department codes', () => {
    expect(territoryOf('974')?.id).toBe('reunion')
    expect(territoryOf('977')?.id).toBe('saint-martin')
    expect(territoryOf('978')?.id).toBe('saint-martin')
    expect(territoryOf('988')?.id).toBe('nouvelle-caledonie')
  })

  it('ignores metropolitan France, Corsica, abroad and empty values', () => {
    for (const d of ['75', '2A', '2B', '999', '', null, undefined]) {
      expect(territoryOf(d)).toBeUndefined()
    }
  })
})

describe('activeTerritories', () => {
  it('returns nothing without an overseas point', () => {
    expect(activeTerritories([pt('75', 48.85, 2.35), pt(null, 0, 0)])).toEqual([])
  })

  it('groups by territory, the busiest first', () => {
    const r = activeTerritories([
      pt('971', 16.24, -61.58),
      pt('974', -21.1, 55.5),
      pt('974', -21.3, 55.45),
      pt('75', 48.85, 2.35),
    ])
    expect(r.map((t) => [t.territory.id, t.count])).toEqual([
      ['reunion', 2],
      ['guadeloupe', 1],
    ])
  })

  it('breaks ties alphabetically', () => {
    const r = activeTerritories([pt('976', -12.8, 45.2), pt('972', 14.6, -61)])
    expect(r.map((t) => t.territory.id)).toEqual(['martinique', 'mayotte'])
  })

  it('widens the framing to points outside the base frame', () => {
    const [polynesie] = activeTerritories([pt('987', -17.55, -149.6), pt('987', -9.8, -139.0)])
    expect(polynesie).toBeDefined()
    expect(polynesie?.bounds[0]).toBeLessThanOrEqual(-149.9)
    expect(polynesie?.bounds[2]).toBeGreaterThanOrEqual(-139.0)
    expect(polynesie?.bounds[3]).toBeGreaterThanOrEqual(-9.8)
  })

  it('does not modify the base framing shared between calls', () => {
    activeTerritories([pt('987', -9.8, -139.0)])
    const [again] = activeTerritories([pt('987', -17.55, -149.6)])
    expect(again?.bounds[2]).toBeLessThan(-148)
  })
})
