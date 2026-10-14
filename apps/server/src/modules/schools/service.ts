import { sql } from 'drizzle-orm'
import type { Database } from '@manifeste/db'
import { rows } from '../../lib/sql.ts'
import type { SchoolDetail, PublicReport } from './model.ts'

export interface NearbySchool {
  uai: string
  name: string
  city: string
  distanceM: number
  level: SchoolDetail['level']
}

export interface SchoolHit {
  uai: string
  name: string
  city: string
  department: string | null
  level: SchoolDetail['level']
}

/** Most schools a lookup returns: the form shows a short list. */
const LIMIT = 15

export class SchoolsService {
  constructor(private readonly db: Database) {}

  async detail(uai: string): Promise<SchoolDetail | null> {
    const found = await rows<SchoolDetail>(
      this.db,
      sql`select s.uai, s.name, s.city, s.postcode, s.department, s.academy, s.kind,
                 st_y(s.location::geometry) as lat, st_x(s.location::geometry) as lng, s.level
          from schools s where s.uai = ${uai}`,
    )
    return found[0] ?? null
  }

  /** Schools within `radiusM` metres of a point, nearest first. */
  nearby(lat: number, lng: number, radiusM: number): Promise<NearbySchool[]> {
    const point = sql`st_setsrid(st_makepoint(${lng}, ${lat}), 4326)::geography`
    return rows<NearbySchool>(
      this.db,
      sql`select s.uai, s.name, s.city, round(st_distance(s.location, ${point}))::int as "distanceM", s.level
          from schools s
          where s.location is not null and st_dwithin(s.location, ${point}, ${radiusM})
          order by 4 limit ${LIMIT}`,
    )
  }

  /** Name and city search, accent and case insensitive, best match first. */
  search(query: string): Promise<SchoolHit[]> {
    const q = sql`normalize_text(${query})`
    return rows<SchoolHit>(
      this.db,
      sql`select s.uai, s.name, s.city, s.department, s.level
          from schools s
          where length(${q}) >= 2
            and (s.name_norm || ' ' || s.city_norm) like '%' || replace(${q}, ' ', '%') || '%'
          order by word_similarity(${q}, s.name_norm || ' ' || s.city_norm) desc, s.name
          limit ${LIMIT}`,
    )
  }

  /** Validated, visible reports of a school over the last `days` days, newest first. */
  async reports(uai: string, days: number): Promise<PublicReport[]> {
    const found = await rows<Omit<PublicReport, 'photoUrl'> & { photoKey: string | null }>(
      this.db,
      sql`select r.id, r.status, r.origin, r.source_url as "sourceUrl", r.source_domain as "sourceDomain",
                 r.observed_at as "observedAt", r.photo_key as "photoKey"
          from reports r
          where r.school_uai = ${uai} and r.moderation = 'approved' and not r.hidden
            and r.observed_at > now() - make_interval(days => ${days}::int)
            and r.observed_at <= now() + interval '10 minutes'
          order by r.observed_at desc
          limit ${days > 1 ? 100 : 20}`,
    )
    return found.map(({ photoKey, ...r }) => ({
      ...r,
      observedAt: new Date(r.observedAt),
      photoUrl: photoKey ? `/api/photos/${photoKey}` : null,
    }))
  }
}
