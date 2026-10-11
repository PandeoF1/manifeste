/**
 * Current and past statuses of schools, from validated reports.
 *
 * - live: the latest report of each school within the status TTL (what the map shows);
 * - past periods: the strongest status of the period, days with signals, sources;
 * - mobilisation: schools with only a "mobilisation" report (judge tiers on), apart from the counted ones.
 *
 * Rules (what counts, the tiers) come from @manifeste/core; the queries only apply them in bulk.
 */
import { sql, type SQL } from 'drizzle-orm'
import { MAX_LOOKBACK_DAYS, periodSince } from '@manifeste/core'
import type { Database } from '@manifeste/db'
import { memoWithTtl } from '../../lib/memo.ts'
import { rows, SOURCE_KEY } from '../../lib/sql.ts'
import type { SettingsService } from '../settings/service.ts'
import type { PeriodName, SchoolStatus } from './model.ts'

/** However many visitors poll, each variant hits the database at most once per interval. */
const CACHE_MS = 30_000

interface Row {
  uai: string
  name: string
  city: string
  department: string | null
  academy: string | null
  lat: number | null
  lng: number | null
  status: SchoolStatus['status']
  lastSignalAt: Date
  sourceCount: number
  signalDays?: number
  level: SchoolStatus['level']
}

const SCHOOL_COLUMNS = sql.raw(`
  s.uai, s.name, s.city, s.department, s.academy,
  st_y(s.location::geometry) as lat, st_x(s.location::geometry) as lng, s.level`)

export class StatusesService {
  private readonly cache = memoWithTtl(
    CACHE_MS,
    (key: { period: PeriodName; mobilisation: boolean }) =>
      this.query(key.period, key.mobilisation),
  )

  constructor(
    private readonly db: Database,
    private readonly settings: SettingsService,
  ) {}

  /** Counted statuses for a period. */
  current(period: PeriodName): Promise<SchoolStatus[]> {
    return this.cache.get({ period, mobilisation: false })
  }

  /** Schools with only a reported mobilisation (empty while judge tiers are off). */
  mobilisation(period: PeriodName): Promise<SchoolStatus[]> {
    return this.cache.get({ period, mobilisation: true })
  }

  /** Bypasses the cache; used by tests and by cache warm-up after a moderation action. */
  invalidate() {
    this.cache.clear()
  }

  private async query(period: PeriodName, mobilisation: boolean): Promise<SchoolStatus[]> {
    const settings = await this.settings.all()
    const tiersOn = settings.judge_tiers
    if (mobilisation && !tiersOn) return []
    const since = periodSince(period, settings)
    const found =
      period === 'live'
        ? await this.live(settings.status_ttl_hours, tiersOn, mobilisation)
        : await this.since(since, tiersOn, mobilisation)
    return found.map((r) => ({ ...r, lastSignalAt: new Date(r.lastSignalAt) }))
  }

  /** What a report must satisfy to be public, for the counted statuses or for mobilisation. */
  private eligible(tiersOn: boolean, mobilisation: boolean): SQL {
    return mobilisation
      ? sql`r.status <> 'lifted' and r.tier = 'mobilisation'`
      : sql`(not ${tiersOn}::boolean or r.tier in ('confirmed', 'unjudged'))`
  }

  private live(ttlHours: number, tiersOn: boolean, mobilisation: boolean) {
    return rows<Row>(
      this.db,
      sql`
      with active as (
        select r.id, r.school_uai, r.status, r.observed_at, r.created_at, ${SOURCE_KEY} as source_key
        from reports r
        where r.moderation = 'approved' and not r.hidden
          and ${this.eligible(tiersOn, mobilisation)}
          and r.observed_at > now() - make_interval(hours => ${ttlHours}::int)
          and r.observed_at <= now() + interval '10 minutes'
      ),
      latest as (
        select distinct on (school_uai) school_uai, status, observed_at
        from active order by school_uai, observed_at desc, created_at desc
      ),
      counts as (
        select school_uai, count(distinct source_key)::int as source_count from active group by 1
      )
      select ${SCHOOL_COLUMNS}, l.status, l.observed_at as "lastSignalAt", c.source_count as "sourceCount"
      from latest l
      join schools s on s.uai = l.school_uai
      join counts c on c.school_uai = l.school_uai
      ${
        mobilisation
          ? sql`where not exists (select 1 from reports x where x.school_uai = l.school_uai
          and x.moderation = 'approved' and not x.hidden and x.tier in ('confirmed', 'unjudged')
          and x.observed_at > now() - make_interval(hours => ${ttlHours}::int)
          and x.observed_at <= now() + interval '10 minutes')`
          : sql``
      }
      order by l.observed_at desc`,
    )
  }

  private since(since: Date, tiersOn: boolean, mobilisation: boolean) {
    return rows<Row>(
      this.db,
      sql`
      with period as (
        select r.*, ${SOURCE_KEY} as source_key
        from reports r
        where r.moderation = 'approved' and not r.hidden
          and ${this.eligible(tiersOn, mobilisation)}
          and r.observed_at > greatest(${since.toISOString()}::timestamptz, now() - make_interval(days => ${MAX_LOOKBACK_DAYS}))
          and r.observed_at <= now() + interval '10 minutes'
      ),
      agg as (
        select p.school_uai,
          (array_agg(p.status order by case p.status when 'blocked' then 0 when 'filtering' then 1 else 2 end))[1] as status,
          max(p.observed_at) as last_signal_at,
          count(distinct p.source_key)::int as source_count,
          count(distinct (p.observed_at at time zone 'Europe/Paris')::date) filter (where p.status <> 'lifted')::int as signal_days
        from period p group by p.school_uai
      )
      select ${SCHOOL_COLUMNS}, a.status, a.last_signal_at as "lastSignalAt",
             a.source_count as "sourceCount", a.signal_days as "signalDays"
      from agg a
      join schools s on s.uai = a.school_uai
      ${
        mobilisation
          ? sql`where not exists (select 1 from reports x where x.school_uai = a.school_uai
          and x.moderation = 'approved' and not x.hidden and x.tier in ('confirmed', 'unjudged')
          and x.observed_at > greatest(${since.toISOString()}::timestamptz, now() - make_interval(days => ${MAX_LOOKBACK_DAYS}))
          and x.observed_at <= now() + interval '10 minutes')`
          : sql``
      }
      order by a.last_signal_at desc`,
    )
  }
}
