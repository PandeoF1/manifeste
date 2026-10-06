import { describe, expect, it } from 'vitest'
import { planGroups } from '@shared/collect-plan.ts'
import { batchByLength } from '@shared/service-db.ts'

const src = (id: string, google = false) => ({
  id,
  label: id,
  identifier: google
    ? `https://news.google.com/rss/search?q=${id}`
    : `https://exemple.fr/${id}.xml`,
})

describe('planGroups', () => {
  it('limite et étale les recherches Google Actualités', () => {
    const sources = [
      src('g1', true),
      src('a'),
      src('g2', true),
      src('b'),
      src('c'),
      src('g3', true),
      src('d'),
    ]
    const groups = planGroups(sources, 2, 2)
    expect(groups.map((g) => g.map((s) => s.id))).toEqual([
      ['g1', 'a', 'b'],
      ['g2', 'c', 'd'],
    ])
  })

  it('crée des groupes dédiés quand il y a plus de recherches que de groupes', () => {
    const groups = planGroups([src('g1', true), src('g2', true), src('a')], 3, 5)
    expect(groups.map((g) => g.map((s) => s.id))).toEqual([['g1', 'a'], ['g2']])
  })
})

describe('batchByLength', () => {
  it('coupe selon la longueur cumulée et le nombre', () => {
    const long = 'x'.repeat(1_000)
    expect(batchByLength([long, long, long, long], 2_500, 50).map((b) => b.length)).toEqual([2, 2])
    expect(batchByLength(['a', 'b', 'c'], 100, 2).map((b) => b.length)).toEqual([2, 1])
    expect(batchByLength([], 100, 2)).toEqual([])
  })
})
