/**
 * Every visible report since the start of the movement, to replay the map at any moment.
 * One response for everything: all the computing (state at time T, histogram) happens in the
 * browser, so scrubbing the timeline never calls the server again.
 */
import { sql } from 'drizzle-orm'
import { MAX_LOOKBACK_DAYS, periodSince } from '@manifeste/core'
import type { Database } from '@manifeste/db'
import { memoWithTtl } from '../../lib/memo.ts'
import { rows, SOURCE_KEY } from '../../lib/sql.ts'
import type { PeriodName } from '../statuses/model.ts'
import type { SettingsService } from '../settings/service.ts'
import type { Timeline } from './model.ts'

/** The response is heavy and changes slowly: one build every 5 minutes at most. */
const CACHE_MS = 5 * 60_000

type Event = Timeline['events'][number]

export class TimelineService {
  private readonly cache = memoWithTtl(CACHE_MS, (period: PeriodName) => this.build(period))

  constructor(
    private readonly db: Database,
    private readonly settings: SettingsService,
  ) {}

  get(period: PeriodName): Promise<Timeline> {
    return this.cache.get(period)
  }

  private async build(period: PeriodName): Promise<Timeline> {
    const settings = await this.settings.all()
    const tiersOn = settings.judge_tiers
    const since = periodSince(period, settings)
    const events = await rows<Event>(
      this.db,
      sql`select r.school_uai as uai, r.status, (extract(epoch from r.observed_at) * 1000)::float8 as at,
                 ${SOURCE_KEY} as "sourceKey",
                 (${tiersOn}::boolean and r.tier = 'mobilisation') as mobilisation
          from reports r
          where r.moderation = 'approved' and not r.hidden
            and (not ${tiersOn}::boolean or r.tier in ('confirmed', 'unjudged')
                 or (r.status <> 'lifted' and r.tier = 'mobilisation'))
            and r.observed_at > greatest(${since.toISOString()}::timestamptz, now() - make_interval(days => ${MAX_LOOKBACK_DAYS}))
            and r.observed_at <= now() + interval '10 minutes'
          order by r.observed_at, r.created_at`,
    )
    const uais = [...new Set(events.map((e) => e.uai))]
    const schools = uais.length
      ? await rows<Timeline['schools'][number]>(
          this.db,
          sql`select s.uai, s.name, s.city, s.department, s.academy,
                     st_y(s.location::geometry) as lat, st_x(s.location::geometry) as lng, s.level
              from schools s where s.uai in (${sql.join(
                uais.map((u) => sql`${u}`),
                sql`, `,
              )})
              order by s.uai`,
        )
      : []
    return { schools, events }
  }
}
