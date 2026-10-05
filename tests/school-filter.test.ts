import { describe, expect, it } from 'vitest'
import { isExcludedEstablishment } from '../scripts/school-filter'

describe('référentiel : établissements exclus', () => {
  it.each([
    ["Section d'enseignement professionnel du Lycée polyvalent Joséphine Baker", true],
    ['Section d’enseignement général et technologique du lycée professionnel X', true],
    ['SEP Raymond Queneau', true],
    // Variantes réelles du jeu de données officiel.
    ["Sectiond'enseignement professionnel du Lycée polyvalent Le Garros", true],
    ['Section Enseignement Professionnel du Lycée polyvalent Bellevue', true],
    ['SECTION ENSEIGNEMENT GENERAL ET TECHNO LP MARCEL BARBANCEY', true],
    ['Section Enseignement Professionnelle Louise Dissard Françoise', true],
    ['S.E.P. MAURICE GENEVOIX', true],
    ['S.E.G.T. du lycée X', true],
    ['Ecole secondaire professionnelle privée Espace Bourgier', true],
    ['École secondaire privée Y', true],
    ['Lycée polyvalent Joséphine Baker', false],
    ['Lycée Raymond Queneau', false],
    ['Lycée professionnel Voltaire', false],
    ['Lycée agricole et agroalimentaire d’Yvetot', false],
    ['Lycée Sévigné', false],
    ['SEPR - Lycée professionnel privé', false],
    ['Lycée Jean Geiler', false],
  ])('%s -> %s', (name, expected) => {
    expect(isExcludedEstablishment(name)).toBe(expected)
  })
})
