import { describe, expect, it } from 'vitest'
import {
  buildReanalysisPrompt,
  extractPageContext,
  parseChoices,
  type ReanalysisItem,
} from '@shared/reanalysis.ts'
import { isGenericSchoolName, levelOfName, stripGenericWords } from '@shared/matching.ts'

describe('contexte de page', () => {
  it('lit titre et résumé (attributs dans les deux ordres, entités HTML)', () => {
    const html = `<html><head>
      <title>Blocus du lycée de Hanches : quelques tensions</title>
      <meta property="og:title" content="Blocus du lycée de Hanches : quelques tensions" />
      <meta content="La mobilisation se poursuit au lyc&eacute;e Jos&#233;phine-Baker de Hanches." property="og:description">
      <meta name="description" content="La mobilisation se poursuit au lycée Joséphine-Baker de Hanches.">
    </head><body>…</body></html>`
    expect(extractPageContext(html)).toBe(
      'Blocus du lycée de Hanches : quelques tensions\nLa mobilisation se poursuit au lycée Joséphine-Baker de Hanches.',
    )
  })
  it('renvoie une chaîne vide sans métadonnées', () => {
    expect(extractPageContext('<html><body>rien</body></html>')).toBe('')
  })
})

describe('choix de l’IA', () => {
  const items: ReanalysisItem[] = [
    {
      id: 'a',
      school_name: 'Lycée de Hanches',
      city: 'Hanches',
      status: 'bloque',
      context: 'Lycée Joséphine-Baker de Hanches',
      candidates: [
        { uai: '0280000A', name: 'Lycée Joséphine Baker', city: 'Hanches', department: '28' },
      ],
    },
    {
      id: 'b',
      school_name: 'Lycée',
      city: 'Paris',
      status: 'bloque',
      context: '',
      candidates: [{ uai: '0750000B', name: 'Lycée X', city: 'Paris', department: '75' }],
    },
  ]
  it('garde les choix sûrs parmi les candidats, ignore les inventions et les doutes', () => {
    const choices = parseChoices(
      {
        choices: [
          { id: 'a', uai: '0280000A', certainty: 'haute' },
          { id: 'b', uai: '9999999Z', certainty: 'haute' }, // code inventé
          { id: 'c', uai: '0750000B', certainty: 'haute' }, // id inconnu
        ],
      },
      items,
    )
    expect([...choices]).toEqual([['a', '0280000A']])
    expect(
      parseChoices({ choices: [{ id: 'b', uai: '0750000B', certainty: 'faible' }] }, items).size,
    ).toBe(0)
    expect(parseChoices('nimporte quoi', items).size).toBe(0)
  })
  it('construit un prompt avec fait, source et candidats', () => {
    const prompt = buildReanalysisPrompt(items.slice(0, 1))
    expect(prompt).toContain('"lycee":"Lycée de Hanches"')
    expect(prompt).toContain('Joséphine-Baker')
    expect(prompt).toContain('"uai":"0280000A"')
  })
})

describe('noms génériques', () => {
  it.each([
    ['Lycée de Hanches', 'Hanches', true],
    ['Lycée', 'Briançon', true],
    ['lycée polyvalent de Saint-Malo', 'Saint-Malo', true],
    ['Lycée Galilée', 'Guérande', false],
    ['lycée agricole', 'Rennes', false],
  ])('%s (%s) -> %s', (name, city, expected) => {
    expect(isGenericSchoolName(name, city)).toBe(expected)
  })
  it('retire les mots génériques', () => {
    expect(stripGenericWords('Lycée professionnel Robert-Buron')).toBe('robert buron')
    expect(stripGenericWords('Fac de Tolbiac')).toBe('tolbiac')
    expect(levelOfName('Université de Nanterre')).toBe('superieur')
    expect(levelOfName('fac de Tolbiac')).toBe('superieur')
    expect(levelOfName('Lycée de l’Université')).toBe('lycee')
    expect(levelOfName('Lycée de Hanches')).toBe('lycee')
    expect(levelOfName('Joliot-Curie')).toBe('lycee')
    expect(stripGenericWords('Université Paris 8')).toBe('paris 8')
    expect(isGenericSchoolName('Université de Nanterre', 'Nanterre')).toBe(true)
  })
})
