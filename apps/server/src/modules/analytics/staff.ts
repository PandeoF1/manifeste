/** Anonymous site statistics for the admin: online now, visitors, views, web vitals. */
import { Elysia, t } from 'elysia'
import { type Database } from '@manifeste/db'
import { sql } from 'drizzle-orm'
import type { Auth } from '../../auth/auth.ts'
import { authPlugin } from '../../auth/plugin.ts'
import { rows } from '../../lib/sql.ts'

const RANGES = {
  '2h': { interval: '2 hours', step: 300 },
  '24h': { interval: '24 hours', step: 900 },
  '7d': { interval: '7 days', step: 3600 },
  '30d': { interval: '30 days', step: 86_400 },
  '90d': { interval: '90 days', step: 86_400 },
} as const
type Range = keyof typeof RANGES

export class AnalyticsStaffService {
  constructor(private readonly db: Database) {}

  async overview(days: number) {
    const [live] = await rows<{ n: number }>(
      this.db,
      sql`select count(*)::int as n from analytics_live where seen_at >= now() - interval '100 seconds'`,
    )
    const livePages = await rows<{ page: string; n: number }>(
      this.db,
      sql`select page, count(*)::int as n from analytics_live where seen_at >= now() - interval '100 seconds' group by page`,
    )
    const [today] = await rows<{ n: number }>(
      this.db,
      sql`select count(*)::int as n from analytics_visitors_today where day = current_date`,
    )
    const daily = await rows<{ day: string; visitors: number; views: number }>(
      this.db,
      sql`select g.day::date::text as day,
            coalesce(ad.visitors, case when g.day::date = current_date
              then (select count(*)::int from analytics_visitors_today where day = current_date) end, 0)::int as visitors,
            coalesce((select sum(views) from analytics_page_views
              where slot >= g.day and slot < g.day + interval '1 day'), 0)::int as views
          from generate_series(current_date - (${days}::int - 1), current_date, interval '1 day') g(day)
          left join analytics_daily ad on ad.day = g.day::date
          order by 1`,
    )
    const hourly = await rows<{ hour: Date; views: number }>(
      this.db,
      sql`select g.hour, coalesce(sum(p.views), 0)::int as views
          from generate_series(date_trunc('hour', now()) - interval '23 hours', date_trunc('hour', now()), interval '1 hour') g(hour)
          left join analytics_page_views p on date_trunc('hour', p.slot) = g.hour
          group by g.hour order by g.hour`,
    )
    const pages = await rows<{ page: string; views: number }>(
      this.db,
      sql`select page, sum(views)::int as views from analytics_page_views where slot >= now() - interval '24 hours' group by page order by 2 desc`,
    )
    const vitals = await rows<{
      metric: string
      n: number
      p50: number | null
      p75: number | null
      p95: number | null
      p75Prev: number | null
    }>(
      this.db,
      sql`select metric,
            count(*) filter (where at >= now() - interval '24 hours')::int as n,
            percentile_cont(0.5) within group (order by value) filter (where at >= now() - interval '24 hours') as p50,
            percentile_cont(0.75) within group (order by value) filter (where at >= now() - interval '24 hours') as p75,
            percentile_cont(0.95) within group (order by value) filter (where at >= now() - interval '24 hours') as p95,
            percentile_cont(0.75) within group (order by value) filter (where at < now() - interval '24 hours' and at >= now() - interval '7 days') as "p75Prev"
          from analytics_vitals where at >= now() - interval '7 days' group by metric`,
    )
    return {
      live: live?.n ?? 0,
      livePages: Object.fromEntries(livePages.map((p) => [p.page, p.n])),
      todayVisitors: today?.n ?? 0,
      daily,
      hourly: hourly.map((h) => ({ hour: new Date(h.hour), views: h.views })),
      pages,
      vitals,
    }
  }

  /** Curves for one zoom level: views, new visitors, online, and 75th percentile of LCP, INP and API. */
  async series(range: Range) {
    const { interval, step } = RANGES[range]
    const points = await rows<{
      t: Date
      views: number
      visitors: number | null
      online: number | null
      lcp: number | null
      inp: number | null
      api: number | null
    }>(
      this.db,
      sql`with g as (
            select generate_series(
              to_timestamp(floor(extract(epoch from now() - ${interval}::interval) / ${step}) * ${step}),
              to_timestamp(floor(extract(epoch from now()) / ${step}) * ${step}),
              make_interval(secs => ${step})) as t)
          select g.t,
            coalesce((select sum(views) from analytics_page_views where slot >= g.t and slot < g.t + make_interval(secs => ${step})), 0)::int as views,
            case when ${step} >= 86400
              then (select visitors from analytics_daily where day = (g.t at time zone 'Europe/Paris')::date)
              else (select sum(count)::int from analytics_new_visitors where slot >= g.t and slot < g.t + make_interval(secs => ${step})) end as visitors,
            (select max(online)::int from analytics_online where minute >= g.t and minute < g.t + make_interval(secs => ${step})) as online,
            (select percentile_cont(0.75) within group (order by value) from analytics_vitals where metric = 'LCP' and at >= g.t and at < g.t + make_interval(secs => ${step})) as lcp,
            (select percentile_cont(0.75) within group (order by value) from analytics_vitals where metric = 'INP' and at >= g.t and at < g.t + make_interval(secs => ${step})) as inp,
            (select percentile_cont(0.75) within group (order by value) from analytics_vitals where metric = 'API' and at >= g.t and at < g.t + make_interval(secs => ${step})) as api
          from g order by g.t`,
    )
    const pages = await rows<{ page: string; views: number }>(
      this.db,
      sql`select page, sum(views)::int as views from analytics_page_views where slot >= now() - ${interval}::interval group by page order by 2 desc`,
    )
    const peak = points.reduce<(typeof points)[number] | null>(
      (m, p) => ((p.online ?? -1) > (m?.online ?? -1) ? p : m),
      null,
    )
    return {
      range,
      stepSeconds: step,
      points: points.map((p) => ({ ...p, t: new Date(p.t) })),
      pages,
      summary: {
        views: points.reduce((n, p) => n + p.views, 0),
        peakOnline: peak?.online ?? null,
        peakOnlineAt: peak?.online != null ? new Date(peak.t) : null,
      },
    }
  }
}

export const analyticsStaffModule = (auth: Auth, service: AnalyticsStaffService) =>
  new Elysia({ name: 'module.analytics.staff', prefix: '/api/staff/analytics' })
    .use(authPlugin(auth))
    .get('/overview', ({ query }) => service.overview(query.days ?? 30), {
      staff: { ai: ['view'] },
      query: t.Object({ days: t.Optional(t.Numeric({ minimum: 1, maximum: 120, default: 30 })) }),
      detail: { tags: ['staff'], summary: 'Online now, visitors, views and web vitals' },
    })
    .get('/series', ({ query }) => service.series(query.range), {
      staff: { ai: ['view'] },
      query: t.Object({
        range: t.Union(
          Object.keys(RANGES).map((r) => t.Literal(r)) as [ReturnType<typeof t.Literal<'24h'>>],
        ),
      }),
      detail: { tags: ['staff'], summary: 'Curves for a zoom level (2h, 24h, 7d, 30d, 90d)' },
    })
