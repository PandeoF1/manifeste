/**
 * Finding the school an extracted name refers to. This is the database half: trigram candidates
 * by name and city, and the schools of a city. The decision (is the best candidate clear enough?)
 * is the pure `pickMatch` of @manifeste/core.
 */
import { sql } from 'drizzle-orm'
import {
  cleanCitation,
  pickMatch,
  type NearbyCandidate,
  type SchoolCandidate,
  type SchoolLevel,
} from '@manifeste/core'
import type { Database } from '@manifeste/db'
import { rows } from '../../lib/sql.ts'

export interface CityHit {
  uai: string
  name: string
  city: string
  department: string | null
}

export class MatchingService {
  constructor(private readonly db: Database) {}

  /**
   * Best candidates for a cited name (and city, when known): 65% name similarity, 35% city
   * similarity. On equal scores the least specific name comes first ("Lycée Condorcet" before
   * "Lycée professionnel Condorcet").
   */
  async candidates(name: string, city: string | null, limit = 5): Promise<SchoolCandidate[]> {
    const cap = Math.max(1, Math.min(limit, 20))
    const n = sql`strip_generic_words(${cleanCitation(name)})`
    const c = sql`normalize_text(${city ?? ''})`
    const found = await rows<SchoolCandidate>(
      this.db,
      sql`select s.uai, s.name, s.city,
            word_similarity(${n}, s.name_norm)::float8 as "nameScore",
            (case when ${c} = '' then 0 else similarity(${c}, s.city_norm) end)::float8 as "cityScore",
            (0.65 * word_similarity(${n}, s.name_norm)
              + 0.35 * case when ${c} = '' then 0 else similarity(${c}, s.city_norm) end)::float8 as score,
            st_y(s.location::geometry) as lat, st_x(s.location::geometry) as lng
          from schools s
          where ${n} <> ''
            and (${c} = '' or s.city_norm % ${c} or s.name_norm like '%' || ${n} || '%')
          order by score desc, length(s.name), s.uai
          limit ${cap}`,
    )
    return found
  }

  /** The matching decision: a UAI only when the best candidate is clear. */
  async match(name: string, city: string | null): Promise<SchoolCandidate | null> {
    return pickMatch(await this.candidates(name, city), Boolean(city?.trim()), undefined, name)
  }

  /** Schools of a city (name similarity ≥ 0.8), optionally of one level. */
  inCity(city: string, limit = 20, level?: SchoolLevel): Promise<CityHit[]> {
    const c = sql`normalize_text(${city})`
    return rows<CityHit>(
      this.db,
      sql`select s.uai, s.name, s.city, s.department
          from schools s
          where ${c} <> '' and similarity(s.city_norm, ${c}) >= 0.8
            ${level ? sql`and s.level = ${level}` : sql``}
          order by similarity(s.city_norm, ${c}) desc, s.name
          limit ${Math.max(1, Math.min(limit, 50))}`,
    )
  }

  /** Schools within `radiusM` metres of a point, for attaching a map point by position. */
  async nearbyForGeo(lat: number, lng: number, radiusM = 500): Promise<NearbyCandidate[]> {
    const point = sql`st_setsrid(st_makepoint(${lng}, ${lat}), 4326)::geography`
    return rows<NearbyCandidate>(
      this.db,
      sql`select s.uai, s.name, round(st_distance(s.location, ${point}))::int as "distanceM"
          from schools s
          where s.location is not null and st_dwithin(s.location, ${point}, ${radiusM})
          order by 3 limit 15`,
    )
  }
}
