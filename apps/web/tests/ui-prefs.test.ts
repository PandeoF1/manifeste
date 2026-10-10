import { describe, expect, it, vi } from 'bun:test'
import { createPanelPrefs } from '@/lib/uiPrefs'

function memory(initial?: string) {
  const data = new Map<string, string>()
  if (initial !== undefined) data.set('manifeste-hidden-panels', initial)
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  }
}

describe('createPanelPrefs', () => {
  it('affiche tout par défaut', () => {
    const p = createPanelPrefs(() => memory())
    expect(['side', 'stats', 'overseas'].map((k) => p.isHidden(k as 'side'))).toEqual([
      false,
      false,
      false,
    ])
  })

  it('bascule, mémorise et prévient les abonnés', () => {
    const store = memory()
    const p = createPanelPrefs(() => store)
    const listener = vi.fn()
    p.subscribe(listener)
    p.toggle('side')
    expect(p.isHidden('side')).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(createPanelPrefs(() => store).isHidden('side')).toBe(true)
    p.toggle('side')
    expect(p.isHidden('side')).toBe(false)
  })

  it('ignore un contenu illisible ou inconnu', () => {
    expect(createPanelPrefs(() => memory('pas du json')).isHidden('stats')).toBe(false)
    expect(createPanelPrefs(() => memory('{"a":1}')).isHidden('stats')).toBe(false)
    const p = createPanelPrefs(() => memory('["stats","autre"]'))
    expect(p.isHidden('stats')).toBe(true)
  })

  it('fonctionne sans stockage (navigation privée)', () => {
    const p = createPanelPrefs(() => undefined)
    p.toggle('overseas')
    expect(p.isHidden('overseas')).toBe(true)
    const broken = createPanelPrefs(() => ({
      getItem: () => {
        throw new Error('bloqué')
      },
      setItem: () => {
        throw new Error('bloqué')
      },
    }))
    expect(() => broken.toggle('side')).not.toThrow()
    expect(broken.isHidden('side')).toBe(true)
  })
})
