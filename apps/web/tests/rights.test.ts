import { describe, expect, it } from 'bun:test'
import { RIGHTS_LINKS, RIGHTS_SECTIONS } from '../src/content/rights'

describe('"Tes droits" window', () => {
  it('covers police, tear gas and police custody', () => {
    expect(RIGHTS_SECTIONS.map((s) => s.id)).toEqual(['forces-de-l-ordre', 'gaz', 'garde-a-vue'])
    for (const s of RIGHTS_SECTIONS) {
      expect(s.points.length).toBeGreaterThanOrEqual(4)
      expect(new Set(s.points).size).toBe(s.points.length)
    }
  })

  it('stays accurate on the verified points (two warnings, custody 24 h + 24 h)', () => {
    const text = RIGHTS_SECTIONS.flatMap((s) => s.points).join(' ')
    expect(text).toMatch(/deux sommations/)
    expect(text).not.toMatch(/trois sommations|3 sommations/)
    expect(text).toMatch(/24 h, prolongeable de 24 h/)
    expect(text).not.toMatch(/jamais plus de 24/i)
  })

  it('links: https or tel, no tracker', () => {
    for (const l of RIGHTS_LINKS) {
      expect(l.href).toMatch(/^(https:\/\/|tel:)/)
      expect(l.href).not.toMatch(/utm_|fbclid|gclid/)
    }
  })
})
