import { describe, expect, it } from 'vitest'
import { isExcludedEstablishment } from '../scripts/school-filter'

describe('référentiel : établissements exclus', () => {
  it.each([
    ["Section d'enseignement professionnel du Lycée polyvalent Joséphine Baker", true],
    ['Section d’enseignement général et technologique du lycée professionnel X', true],
    ['SEP Raymond Queneau', true],
    ['Ecole secondaire professionnelle privée Espace Bourgier', true],
    ['École secondaire privée Y', true],
    ['Lycée polyvalent Joséphine Baker', false],
    ['Lycée Raymond Queneau', false],
    ['Lycée professionnel Voltaire', false],
    ['Lycée agricole et agroalimentaire d’Yvetot', false],
  ])('%s -> %s', (name, expected) => {
    expect(isExcludedEstablishment(name)).toBe(expected)
  })
})
