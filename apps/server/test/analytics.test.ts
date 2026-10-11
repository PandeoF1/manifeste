import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { schema } from '@manifeste/db'
import { AnalyticsService } from '../src/modules/analytics/service.ts'
import { startTestServer, type TestServer } from './helpers.ts'

let s: TestServer
let service: AnalyticsService

beforeAll(async () => {
  s = await startTestServer()
  service = new AnalyticsService(s.ctx.db)
})
afterAll(() => s.close())

const beacon = (ip: string, json: unknown, headers: Record<string, string> = {}) =>
  s.request('/api/analytics/beacon', {
    method: 'POST',
    json,
    headers: { 'cf-connecting-ip': ip, 'user-agent': 'Mozilla/5.0', ...headers },
  })

const count = async (table: string) =>
  Number((await s.ctx.db.execute(sql.raw(`select count(*)::int as n from ${table}`))).rows[0]?.n)

describe('anonymous analytics', () => {
  test('a page view counts a new visitor once a day, and every view', async () => {
    expect((await beacon('203.0.113.1', { page: 'map', view: true, metrics: [] })).status).toBe(204)
    expect((await beacon('203.0.113.1', { page: 'list', view: true, metrics: [] })).status).toBe(
      204,
    )
    expect((await beacon('203.0.113.2', { page: 'map', view: true, metrics: [] })).status).toBe(204)
    expect(await count('analytics_visitors_today')).toBe(2)
    const [slots] = (
      await s.ctx.db.execute(sql`select sum(count)::int as n from analytics_new_visitors`)
    ).rows
    expect(slots?.n).toBe(2)
    const [views] = (
      await s.ctx.db.execute(sql`select sum(views)::int as n from analytics_page_views`)
    ).rows
    expect(views?.n).toBe(3)
  })

  test('the IP is never stored, only a salted hash', async () => {
    const rows = (await s.ctx.db.execute(sql`select visitor from analytics_visitors_today`)).rows
    for (const r of rows) {
      expect(String(r.visitor)).toMatch(/^[0-9a-f]{64}$/)
      expect(String(r.visitor)).not.toContain('203.0.113')
    }
  })

  test('web vitals are stored when plausible, dropped otherwise', async () => {
    await beacon('203.0.113.3', {
      page: 'school',
      view: false,
      metrics: [
        { name: 'LCP', value: 1800 },
        { name: 'CLS', value: 0.05 },
        { name: 'LCP', value: 999_999 },
        { name: 'CLS', value: 42 },
        { name: 'API', value: -1 },
      ],
    })
    const metrics = (await s.ctx.db.select().from(schema.analyticsVitals))
      .map((v) => v.metric)
      .sort()
    expect(metrics).toEqual(['CLS', 'LCP'])
  })

  test('robots, Do Not Track, GPC and oversized bodies are ignored', async () => {
    const before = await count('analytics_page_views')
    const body = { page: 'map', view: true, metrics: [] }
    await beacon('198.51.100.1', body, { 'user-agent': 'Googlebot/2.1' })
    await beacon('198.51.100.2', body, { dnt: '1' })
    await beacon('198.51.100.3', body, { 'sec-gpc': '1' })
    await beacon('198.51.100.4', body, { 'content-length': '999999' })
    expect(await count('analytics_page_views')).toBe(before)
  })

  test('an unknown page is a validation error, not a stored row', async () => {
    expect((await beacon('198.51.100.5', { page: 'admin', view: true, metrics: [] })).status).toBe(
      422,
    )
  })

  test('live tabs: ping, snapshot and expiry', async () => {
    const tab = crypto.randomUUID()
    await s.request('/api/analytics/ping', { method: 'POST', json: { session: tab, page: 'map' } })
    await s.request('/api/analytics/ping', { method: 'POST', json: { session: tab, page: 'list' } })
    expect(await count('analytics_live')).toBe(1)
    await service.snapshotOnline()
    const [online] = (await s.ctx.db.execute(sql`select online from analytics_online`)).rows
    expect(online?.online).toBe(1)
    await s.ctx.db.execute(sql`update analytics_live set seen_at = now() - interval '11 minutes'`)
    await service.ping(crypto.randomUUID(), 'map')
    expect(await count('analytics_live')).toBe(1)
  })

  test('the nightly rollup keeps counts and destroys hashes and old salts', async () => {
    const db = s.ctx.db
    await db.execute(sql`insert into daily_salts (day, salt) values (current_date - 1, 'old')`)
    await db.execute(
      sql`insert into analytics_visitors_today (day, visitor) values (current_date - 1, 'a'), (current_date - 1, 'b')`,
    )
    await db.execute(
      sql`insert into submission_limits (visitor, day, count) values ('x', current_date - 1, 3)`,
    )
    await service.rollup()
    const daily = (
      await db.execute(sql`select visitors from analytics_daily where day = current_date - 1`)
    ).rows
    expect(daily[0]?.visitors).toBe(2)
    expect(await count('daily_salts')).toBe(1)
    expect(
      (
        await db.execute(
          sql`select count(*)::int as n from analytics_visitors_today where day < current_date`,
        )
      ).rows[0]?.n,
    ).toBe(0)
    expect(await count('submission_limits')).toBe(0)
    // Today's hashes survive: they are still needed to count today's visitors.
    expect(
      (
        await db.execute(
          sql`select count(*)::int as n from analytics_visitors_today where day = current_date`,
        )
      ).rows[0]?.n,
    ).toBe(2)
  })

  test('the same visitor hashes differently for different purposes and days', async () => {
    const a = await service.visitor('203.0.113.1', 'visit')
    const b = await service.visitor('203.0.113.1', 'report')
    expect(a).not.toBe(b)
    expect(await service.visitor('203.0.113.1', 'visit')).toBe(a)
  })
})

describe('the pages the site reports', () => {
  test('the browser and the API agree on the names, or every beacon would be refused', async () => {
    const { PAGES } = await import('../../web/src/lib/pageGroup.ts')
    const { ANALYTICS_PAGES } = await import('@manifeste/db')
    expect([...PAGES].sort()).toEqual([...ANALYTICS_PAGES].sort())
  })
})
