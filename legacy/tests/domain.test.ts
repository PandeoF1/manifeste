import { describe, expect, it } from 'vitest'
import { extractDomain, normalizeDomainInput } from '@shared/domain.ts'

describe('extractDomain', () => {
  it.each([
    ['https://www.lemonde.fr/societe/article/x.html', 'lemonde.fr'],
    ['https://m.facebook.com/x', 'facebook.com'],
    ['https://Actu.FR/bretagne', 'actu.fr'],
    ['https://t.me/canal/12', 't.me'],
    ['https://amp.leparisien.fr/x', 'leparisien.fr'],
  ])('%s -> %s', (url, expected) => {
    expect(extractDomain(url)).toBe(expected)
  })

  it.each(['http://lemonde.fr', 'pas une url', 'https://localhost/x', 'javascript:alert(1)'])(
    'refuse %s',
    (url) => {
      expect(extractDomain(url)).toBeNull()
    },
  )

  it('normalise une saisie manuelle', () => {
    expect(normalizeDomainInput(' www.Ouest-France.fr/ ')).toBe('ouest-france.fr')
    expect(normalizeDomainInput('http://sudouest.fr')).toBe('sudouest.fr')
    expect(normalizeDomainInput('')).toBeNull()
  })
})
