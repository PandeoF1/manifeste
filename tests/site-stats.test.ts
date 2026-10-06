import { describe, expect, it } from 'vitest'
import { formatMetric, parseSiteStats, rate } from '@/lib/siteStats'
import { pageGroup } from '@/lib/pageGroup'

describe('statistiques du site', () => {
  it('note les mesures selon les seuils Web Vitals', () => {
    expect(rate('LCP', 2400)).toBe('good')
    expect(rate('LCP', 3000)).toBe('warn')
    expect(rate('LCP', 4100)).toBe('poor')
    expect(rate('CLS', 0.05)).toBe('good')
    expect(formatMetric('LCP', 1840)).toBe('1,84 s')
    expect(formatMetric('INP', 96.4)).toBe('96 ms')
    expect(formatMetric('CLS', 0.031)).toBe('0,03')
    expect(formatMetric('API', null)).toBe('-')
  })

  it("n'envoie que le type de page, jamais l'adresse", () => {
    expect(pageGroup('/')).toBe('carte')
    expect(pageGroup('/lycee/0750001A')).toBe('lycee')
    expect(pageGroup('/liste')).toBe('liste')
    expect(pageGroup('/admin')).toBeNull()
    expect(pageGroup('/xyz')).toBe('autre')
  })

  it('lit la réponse de admin_analytics', () => {
    const s = parseSiteStats({
      live: 3,
      live_pages: { carte: '2' },
      today_visitors: 10,
      daily: [{ day: '2026-10-06', visitors: 10, views: '25' }],
      hourly: [],
      pages: [{ page: 'carte', views: 20 }],
      vitals: [
        { metric: 'LCP', n: 4, p50: 1200, p75: '1500', p95: 3000, p75_prev: null },
        { metric: 'X' },
      ],
    })
    expect(s.live_pages.carte).toBe(2)
    expect(s.daily[0]?.views).toBe(25)
    expect(s.vitals).toHaveLength(1)
    expect(s.vitals[0]?.p75).toBe(1500)
    expect(parseSiteStats(null).daily).toEqual([])
  })
})
