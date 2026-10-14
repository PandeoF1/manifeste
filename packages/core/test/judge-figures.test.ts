import { describe, expect, test } from 'bun:test'
import { figures, type FigureRow } from '../src/index.ts'

const NOW = new Date('2026-10-08T12:00:00Z')
const row = (over: Partial<FigureRow>): FigureRow => ({
  uai: 'A',
  department: '59',
  level: 'secondary',
  status: 'blocked',
  observedAt: new Date('2026-10-08T10:00:00Z'),
  domain: 'x.fr',
  tier: 'confirmed',
  nature: 'blockade',
  ...over,
})

describe('figures by tier set', () => {
  const rows = [
    row({ uai: 'A' }),
    row({ uai: 'B', department: '62', tier: 'mobilisation', nature: 'gathering', domain: 'y.fr' }),
    row({ uai: 'C', level: 'higher', tier: 'unjudged', nature: null, department: '75' }),
    row({ uai: 'D', status: 'lifted' }),
    row({ uai: 'E', observedAt: new Date('2026-10-01T10:00:00Z') }),
    row({ uai: 'F', observedAt: new Date('2026-10-09T10:00:00Z') }), // in the future
  ]

  test('only the tiers asked for count, lifted and future reports never do', () => {
    const all = figures(rows, ['confirmed', 'mobilisation', 'unjudged'], NOW)
    expect(all.schools).toBe(4) // A, B, C, E
    expect(all.departments).toBe(3)
    expect(all.higherEducation).toBe(1)
    expect(all.sources).toBe(2)
    expect(figures(rows, ['confirmed'], NOW).schools).toBe(2) // A, E
  })

  test('the best day and what is happening now', () => {
    const f = figures(rows, ['confirmed', 'mobilisation', 'unjudged'], NOW)
    expect(f.peak).toEqual({ day: '2026-10-08', schools: 3 })
    expect(f.now).toEqual({ total: 3, blocked: 3 })
  })

  test('natures keep the clearest one per school', () => {
    const f = figures(
      [
        row({ uai: 'A', nature: 'gathering' }),
        row({ uai: 'A', nature: 'blockade' }),
        row({ uai: 'B', nature: null }),
      ],
      ['confirmed'],
      NOW,
    )
    expect(f.natures).toEqual({ blockade: 1, unjudged: 1 })
  })
})
