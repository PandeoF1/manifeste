import { describe, expect, it } from 'bun:test'
import { sourceCount } from '@/lib/confidence'

describe('sourceCount', () => {
  it('shows the number of sources without ever writing "confirmé"', () => {
    expect(sourceCount(3)).toMatchObject({ level: 'plusieurs', label: '3 sources' })
    expect(sourceCount(1)).toMatchObject({ level: 'unique', label: '1 source' })
    for (const n of [0, 1, 2, 9]) {
      expect(sourceCount(n).label.toLowerCase()).not.toContain('confirm')
      expect(sourceCount(n).detail.toLowerCase()).not.toContain('confirmé')
    }
  })
  it('no source or invalid value: unknown', () => {
    for (const v of [0, -3, null, undefined, Number.NaN]) {
      expect(sourceCount(v).level).toBe('inconnu')
    }
  })
})
