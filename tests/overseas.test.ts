import { describe, expect, it } from 'vitest'
import { activeTerritories, inMetropole, territoryOf } from '@/lib/overseas'

const pt = (department: string | null, lat: number, lng: number) => ({ department, lat, lng })

describe('territoryOf', () => {
  it('rattache les codes départements d’outre-mer', () => {
    expect(territoryOf('974')?.id).toBe('reunion')
    expect(territoryOf('977')?.id).toBe('saint-martin')
    expect(territoryOf('978')?.id).toBe('saint-martin')
    expect(territoryOf('988')?.id).toBe('nouvelle-caledonie')
  })

  it('ignore la métropole, la Corse, l’étranger et les valeurs vides', () => {
    for (const d of ['75', '2A', '2B', '999', '', null, undefined]) {
      expect(territoryOf(d)).toBeUndefined()
    }
  })
})

describe('activeTerritories', () => {
  it('ne renvoie rien sans point d’outre-mer', () => {
    expect(activeTerritories([pt('75', 48.85, 2.35), pt(null, 0, 0)])).toEqual([])
  })

  it('regroupe par territoire, le plus fourni d’abord', () => {
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

  it('départage à égalité par ordre alphabétique', () => {
    const r = activeTerritories([pt('976', -12.8, 45.2), pt('972', 14.6, -61)])
    expect(r.map((t) => t.territory.id)).toEqual(['martinique', 'mayotte'])
  })

  it('élargit le cadrage aux points hors du cadre de base', () => {
    const [polynesie] = activeTerritories([pt('987', -17.55, -149.6), pt('987', -9.8, -139.0)])
    expect(polynesie).toBeDefined()
    expect(polynesie?.bounds[0]).toBeLessThanOrEqual(-149.9)
    expect(polynesie?.bounds[2]).toBeGreaterThanOrEqual(-139.0)
    expect(polynesie?.bounds[3]).toBeGreaterThanOrEqual(-9.8)
  })

  it('ne modifie pas le cadrage de base partagé entre appels', () => {
    activeTerritories([pt('987', -9.8, -139.0)])
    const [again] = activeTerritories([pt('987', -17.55, -149.6)])
    expect(again?.bounds[2]).toBeLessThan(-148)
  })
})

describe('inMetropole', () => {
  it('reconnaît la métropole, la Corse et ses abords', () => {
    expect(inMetropole(46.6, 2.4)).toBe(true)
    expect(inMetropole(42.15, 9.1)).toBe(true)
    expect(inMetropole(48.4, -4.5)).toBe(true)
  })

  it('refuse l’outre-mer et le reste du monde', () => {
    expect(inMetropole(-21.1, 55.5)).toBe(false)
    expect(inMetropole(14.6, -61)).toBe(false)
    expect(inMetropole(-20, 170)).toBe(false)
    expect(inMetropole(35, 2)).toBe(false)
  })
})
