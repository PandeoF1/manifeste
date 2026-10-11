/**
 * Anonymous, first-party statistics. Nothing identifying is stored: a visitor of the day is
 * SHA-256(daily salt | IP). The salt is random, kept for the current day only and deleted by the
 * nightly job, so yesterday's hashes can never be linked to today's (or reversed). The IP itself
 * is never written anywhere. Only aggregates survive the day.
 */
import { createHash, randomBytes } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { schema, type Database } from '@manifeste/db'
import { rows } from '../../lib/sql.ts'

type Page = (typeof schema.analyticsPage.enumValues)[number]
type Vital = (typeof schema.webVital.enumValues)[number]

/** Robots, previews and tools: never counted. */
const BOT_AGENT = /(bot|crawl|spider|slurp|preview|headless|lighthouse|pagespeed|curl|wget)/i

/** Plausible ranges (ms, or unitless for CLS): anything else is a broken or hostile client. */
const VITAL_RANGE: Record<Vital, [number, number]> = {
  LCP: [0, 60_000],
  INP: [0, 60_000],
  FCP: [0, 60_000],
  TTFB: [0, 60_000],
  API: [0, 60_000],
  CLS: [0, 10],
}

/** Largest beacon body kept (bytes): the real ones are a few hundred. */
export const MAX_BEACON_BYTES = 2048

export const isBot = (userAgent: string | null | undefined): boolean =>
  BOT_AGENT.test(userAgent ?? '')

export interface Beacon {
  page: Page
  view: boolean
  metrics: Array<{ name: Vital; value: number }>
}

export class AnalyticsService {
  constructor(private readonly db: Database) {}

  /** Today's salt, created on first use. */
  async salt(): Promise<string> {
    const fresh = randomBytes(32).toString('hex')
    await this.db.execute(
      sql`insert into daily_salts (day, salt) values (current_date, ${fresh}) on conflict (day) do nothing`,
    )
    const [row] = await rows<{ salt: string }>(
      this.db,
      sql`select salt from daily_salts where day = current_date`,
    )
    if (!row) throw new Error('daily salt missing')
    return row.salt
  }

  /** A visitor of the day: not reversible, not comparable across days. */
  async visitor(ip: string, purpose: string): Promise<string> {
    const salt = await this.salt()
    return createHash('sha256').update(`${salt}|${purpose}|${ip}`).digest('hex')
  }

  /** Records a page view and/or web vitals. */
  async record(ip: string, beacon: Beacon): Promise<void> {
    if (beacon.view) {
      const visitor = await this.visitor(ip, 'visit')
      const inserted = await rows<{ n: number }>(
        this.db,
        sql`insert into analytics_visitors_today (day, visitor) values (current_date, ${visitor})
            on conflict do nothing returning 1 as n`,
      )
      // A "new visitor of the day" is counted in its 5-minute slot (a number, no hash): the curve
      // stays complete after the hashes are deleted.
      if (inserted.length > 0) {
        await this.db.execute(
          sql`insert into analytics_new_visitors (slot, count)
              values (date_bin('5 minutes', now(), timestamptz '2000-01-01'), 1)
              on conflict (slot) do update set count = analytics_new_visitors.count + 1`,
        )
      }
      await this.db.execute(
        sql`insert into analytics_page_views (slot, page, views)
            values (date_bin('5 minutes', now(), timestamptz '2000-01-01'), ${beacon.page}, 1)
            on conflict (slot, page) do update set views = analytics_page_views.views + 1`,
      )
    }
    for (const m of beacon.metrics.slice(0, 12)) {
      const [min, max] = VITAL_RANGE[m.name]
      if (!Number.isFinite(m.value) || m.value < min || m.value > max) continue
      await this.db.insert(schema.analyticsVitals).values({
        page: beacon.page,
        metric: m.name,
        value: m.value,
      })
    }
  }

  /** "Tab open" signal: one random id per tab, forgotten after 10 minutes. */
  async ping(session: string, page: Page): Promise<void> {
    await this.db.execute(
      sql`delete from analytics_live where seen_at < now() - interval '10 minutes'`,
    )
    await this.db
      .insert(schema.analyticsLive)
      .values({ session, page })
      .onConflictDoUpdate({
        target: schema.analyticsLive.session,
        set: { page, seenAt: sql`now()` },
      })
  }

  /** Every minute: how many tabs signalled in the last 100 seconds. */
  async snapshotOnline(): Promise<void> {
    await this.db.execute(
      sql`insert into analytics_online (minute, online)
          select date_trunc('minute', now()), count(*) from analytics_live
          where seen_at >= now() - interval '100 seconds'
          on conflict (minute) do update set online = excluded.online`,
    )
  }

  /**
   * Nightly: turns yesterday's visitor hashes into a count, deletes the hashes and the salts of
   * previous days (this is what makes visitors unlinkable), then applies the retention windows.
   */
  async rollup(): Promise<void> {
    await this.db.execute(
      sql`insert into analytics_daily (day, visitors)
          select day, count(*)::int from analytics_visitors_today where day < current_date group by day
          on conflict (day) do update set visitors = excluded.visitors`,
    )
    await this.db.execute(sql`delete from analytics_visitors_today where day < current_date`)
    await this.db.execute(sql`delete from daily_salts where day < current_date`)
    await this.db.execute(sql`delete from submission_limits where day < current_date`)
    await this.db.execute(sql`delete from analytics_vitals where at < now() - interval '30 days'`)
    await this.db.execute(
      sql`delete from analytics_page_views where slot < now() - interval '120 days'`,
    )
    await this.db.execute(
      sql`delete from analytics_online where minute < now() - interval '14 days'`,
    )
    await this.db.execute(
      sql`delete from analytics_new_visitors where slot < now() - interval '120 days'`,
    )
  }
}
