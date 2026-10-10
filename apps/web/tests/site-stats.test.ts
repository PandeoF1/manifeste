import { describe, expect, it } from 'bun:test'
import { formatMetric, parseSiteStats, rate } from '@/lib/siteStats'
import { pageGroup } from '@/lib/pageGroup'

describe('site statistics', () => {
  it('rates measurements against the Web Vitals thresholds', () => {
    expect(rate('LCP', 2400)).toBe('good')
    expect(rate('LCP', 3000)).toBe('warn')
    expect(rate('LCP', 4100)).toBe('poor')
    expect(rate('CLS', 0.05)).toBe('good')
    expect(formatMetric('LCP', 1840)).toBe('1,84 s')
    expect(formatMetric('INP', 96.4)).toBe('96 ms')
    expect(formatMetric('CLS', 0.031)).toBe('0,03')
    expect(formatMetric('API', null)).toBe('-')
  })

  it('only sends the page type, never the address', () => {
    expect(pageGroup('/')).toBe('carte')
    expect(pageGroup('/lycee/0750001A')).toBe('lycee')
    expect(pageGroup('/liste')).toBe('liste')
    expect(pageGroup('/admin')).toBeNull()
    expect(pageGroup('/donnees')).toBe('donnees')
    expect(pageGroup('/xyz')).toBe('autre')
  })

  it('reads the admin_analytics response', () => {
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

describe('statistics zoom', () => {
  it('reads a series and keeps the gaps (null)', async () => {
    const { parseSeries } = await import('@/lib/siteStats')
    const s = parseSeries({
      range: '2h',
      step_seconds: 300,
      points: [
        {
          t: '2026-10-06T15:00:00Z',
          views: 3,
          visitors: null,
          online: 2,
          lcp: 900,
          inp: null,
          api: '150',
        },
      ],
      pages: [{ page: 'carte', views: 3 }],
      summary: {
        views: 3,
        peak_online: 2,
        peak_online_at: '2026-10-06T15:01:00Z',
        lcp_p75: 900,
        api_p75: null,
      },
    })
    expect(s.points[0]).toMatchObject({ views: 3, visitors: null, online: 2, api: 150 })
    expect(s.summary.peakOnline).toBe(2)
    expect(parseSeries({ range: 'xx' }).range).toBe('24h')
  })

  it('formats slots in Paris time', async () => {
    const { formatBucket } = await import('@/lib/siteStats')
    expect(formatBucket('2026-10-06T15:05:00Z', 300)).toBe('17:05')
    expect(formatBucket('2026-10-06T22:00:00Z', 86_400)).toBe('7 oct.')
  })
})
