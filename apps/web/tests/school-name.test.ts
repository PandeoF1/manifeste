import { describe, expect, it } from 'bun:test'
import { formatSchoolName } from '@/lib/schoolName'

describe('formatSchoolName', () => {
  it('formats the typed names', () => {
    expect(formatSchoolName('lycee agricole jean monnet')).toBe('Lycée agricole Jean-Monnet')
    expect(formatSchoolName('LYCÉE VICTOR HUGO')).toBe('Lycée Victor-Hugo')
    expect(formatSchoolName('lycée de la mer')).toBe('Lycée de la Mer')
    expect(formatSchoolName('saint joseph')).toBe('Lycée Saint-Joseph')
    expect(formatSchoolName('lp gustave eiffel')).toBe('Lycée professionnel Gustave-Eiffel')
    expect(formatSchoolName("lycée d'arsonval")).toBe("Lycée d'Arsonval")
  })
})
