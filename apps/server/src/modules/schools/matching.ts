/**
 * Finding the school an extracted name refers to. This is the database half: trigram candidates
 * by name and city, and the schools of a city. The decision (is the best candidate clear enough?)
 * is the pure `pickMatch` of @manifeste/core.
 *
 * `resolve` chains the strategies, from the surest to the loosest; each one applies only when the
 * previous found nothing, and each returns a UAI only when it is unambiguous:
 *   1. memory      the same name and city were linked by a staff member before
 *      alias       a curated citation of an institution under another name ("Catho d'Angers")
 *   2. name        trigram match on the name without its generic words, plus aliases
 *   3. university  "fac de droit", "IUT", "campus X" in a city with one local university
 *   4. nearby      an exact name in a neighbouring town ("Brossolette" cited in Lyon: Villeurbanne)
 *   5. context     no city cited: the one candidate whose city the article mentions
 */
import { sql } from 'drizzle-orm'
import {
  cleanCitation,
  decodeEntities,
  findAlias,
  institutionKey,
  isGenericSchoolName,
  isPartOfUniversity,
  levelOfName,
  normalizeWords,
  pickMatch,
  stripGenericWords,
  WEAK_NAME_WORDS,
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

export type ResolveVia = 'memory' | 'alias' | 'name' | 'university' | 'nearby' | 'context'

export interface Resolved {
  uai: string
  via: ResolveVia
}

/** A neighbouring town is searched within this distance of the cited city. */
export const NEARBY_RADIUS_M = 25_000

export class MatchingService {
  constructor(private readonly db: Database) {}

  /**
   * Best candidates for a cited name (and city, when known): 65% name similarity, 35% city
   * similarity. The name is compared with the school's name without its generic words ("Lycée
   * général et technologique des Arènes" is "arènes"), and a citation that contains every word of
   * the school's name ("Auguste-Brizeux" for "Lycée Brizeux") scores 0.9. On equal scores the
   * least specific name comes first ("Lycée Condorcet" before "Lycée professionnel Condorcet").
   */
  async candidates(name: string, city: string | null, limit = 5): Promise<SchoolCandidate[]> {
    const cap = Math.max(1, Math.min(limit, 20))
    const n = sql`strip_generic_words(${cleanCitation(name)})`
    const c = sql`normalize_text(${decodeEntities(city ?? '')})`
    const found = await rows<SchoolCandidate>(
      this.db,
      sql`with q as (select ${n} as n, ${c} as c),
          s as (
            select s.*, strip_generic_words(s.name) as core, strip_generic_words(s.city) as core_city
            from schools s
          ),
          scored as (
            select s.*, q.c,
              greatest(word_similarity(q.n, s.name_norm), similarity(q.n, s.core),
                case when ${containsName} then 0.9 else 0 end,
                case when exists (select 1 from unnest(s.aliases) a where strip_generic_words(a) = q.n) then 1 else 0 end
              )::float8 as name_score,
              (case when q.c = '' then 0 else ${cityScore} end)::float8 as city_score
            from s, q
            where q.n <> ''
              and (q.c = '' or s.city_norm % q.c or s.city_norm like q.c || ' %' or q.c like s.city_norm || ' %'
                   or s.name_norm like '%' || q.n || '%')
          )
          select uai, name, city, level, name_score as "nameScore", city_score as "cityScore",
            (0.65 * name_score + 0.35 * city_score)::float8 as score,
            st_y(location::geometry) as lat, st_x(location::geometry) as lng
          from scored
          where (c <> '' or name_score > 0.3)
          order by score desc, length(name), uai
          limit ${cap}`,
    )
    return found
  }

  /** The matching decision: a UAI only when the best candidate is clear. */
  async match(name: string, city: string | null): Promise<SchoolCandidate | null> {
    return pickMatch(await this.candidates(name, city), Boolean(city?.trim()), undefined, name)
  }

  /**
   * The school a citation names, by the surest strategy that is unambiguous (see the top of the
   * file). `hint` is text around the citation (title, excerpt, address) used when no city is cited.
   */
  async resolve(
    name: string,
    city: string | null,
    hint = '',
    options: { memory?: boolean } = {},
  ): Promise<Resolved | null> {
    const cityName = (city && decodeEntities(city).trim()) || null
    const remembered = options.memory === false ? null : await this.memory(name, cityName)
    if (remembered) return { uai: remembered, via: 'memory' }
    const aliased = findAlias(name, cityName)
    // The list is curated by hand: a UAI the directory no longer has must not be returned.
    if (aliased && (await this.exists(aliased))) return { uai: aliased, via: 'alias' }
    const byName = await this.match(name, cityName)
    if (byName) return { uai: byName.uai, via: 'name' }
    if (cityName) {
      if (
        levelOfName(name) === 'higher' &&
        (isPartOfUniversity(name) || isGenericSchoolName(name, cityName))
      ) {
        const uni = await this.universityOf(cityName)
        if (uni) return { uai: uni.uai, via: 'university' }
      }
      const near = await this.nearby(name, cityName)
      if (near) return { uai: near.uai, via: 'nearby' }
    } else if (hint) {
      const ctx = await this.byContext(name, hint)
      if (ctx) return { uai: ctx.uai, via: 'context' }
    }
    return null
  }

  private async exists(uai: string): Promise<boolean> {
    const [found] = await rows<{ uai: string }>(
      this.db,
      sql`select uai from schools where uai = ${uai}`,
    )
    return Boolean(found)
  }

  /**
   * What staff decided before for the same citation, when every link agrees (two schools for one
   * name and city is a genuine tie). The linked school must still look like the citation: it
   * shares a word of its name with it. A link made through the previous site's import can be
   * wrong, and one wrong link must not become the rule. With no city cited, the name alone
   * counts, but only after at least three agreeing links ("cité scolaire Balzac" is the Paris one).
   */
  async memory(name: string, city: string | null): Promise<string | null> {
    const key = (s: string) => stripGenericWords(cleanCitation(s))
    const n = key(name)
    if (n === '') return null
    const cityKey = normalizeWords(decodeEntities(city ?? '')).join(' ')
    const links = await rows<{ name: string; city: string | null; uai: string; core: string }>(
      this.db,
      sql`select u.school_name as name, u.city, u.linked_uai as uai, strip_generic_words(s.name) as core
          from unmatched u join schools s on s.uai = u.linked_uai
          where u.resolution = 'linked' and u.linked_uai is not null`,
    )
    const words = new Set(n.split(' '))
    const same = links.filter(
      (l) =>
        key(l.name) === n &&
        l.core.split(' ').some((w) => words.has(w)) &&
        (cityKey === '' || normalizeWords(decodeEntities(l.city ?? '')).join(' ') === cityKey),
    )
    const uais = new Set(same.map((l) => l.uai))
    if (uais.size !== 1) return null
    return cityKey === '' && same.length < 3 ? null : (same[0]?.uai ?? null)
  }

  /**
   * The school with exactly the cited name in a town near the cited city: an article about Lyon
   * names "Brossolette", the school is in Villeurbanne. Nothing is returned when two schools fit.
   */
  async nearby(
    name: string,
    city: string,
    radiusM = NEARBY_RADIUS_M,
  ): Promise<SchoolCandidate | null> {
    const n = stripGenericWords(cleanCitation(name))
    const c = sql`normalize_text(${city})`
    // "fac de droit" names no school, only a kind of place: any town has one.
    if (n === '' || isPartOfUniversity(name)) return null
    const found = await rows<SchoolCandidate>(
      this.db,
      sql`with q as (select ${n}::text as n, ${c} as c),
          centre as (
            select st_centroid(st_collect(s.location::geometry))::geography as g
            from schools s, q
            where s.location is not null
              and (s.city_norm = q.c
                   or (s.city_norm like q.c || ' %' and not exists (select 1 from schools x where x.city_norm = q.c)))
          ),
          s as (select s.*, strip_generic_words(s.name) as core from schools s)
          select s.uai, s.name, s.city, s.level, 1::float8 as "nameScore", 0::float8 as "cityScore", 1::float8 as score,
            st_y(s.location::geometry) as lat, st_x(s.location::geometry) as lng
          from s, q, centre
          where centre.g is not null and s.location is not null and st_dwithin(s.location, centre.g, ${radiusM})
            and s.core <> '' and not (string_to_array(s.core, ' ') <@ string_to_array(strip_generic_words(s.city), ' '))
            and not (string_to_array(s.core, ' ') <@ ${weakWords})
            and (string_to_array(s.core, ' ') <@ string_to_array(q.n, ' ')
                 or string_to_array(q.n, ' ') <@ string_to_array(s.core, ' ')
                 or exists (select 1 from unnest(s.aliases) a where strip_generic_words(a) = q.n))
          order by length(s.name), s.uai`,
    )
    return onlyOne(found, levelOfName(name))
  }

  /**
   * The local university of a city, for "fac de droit" or "IUT": the one institution of the city
   * (a university's sites count as one), or, when two compete, the one whose sites are mostly in
   * this city (Université du Maine in Le Mans, not the Nantes outpost there).
   */
  async universityOf(city: string): Promise<SchoolCandidate | null> {
    const c = sql`normalize_text(${city})`
    const found = await rows<SchoolCandidate & { total: number; here: number }>(
      this.db,
      sql`select s.uai, s.name, s.city, s.level, 1::float8 as "nameScore", 1::float8 as "cityScore", 1::float8 as score,
            (select count(*) from schools t where t.level = 'higher'
               and split_part(t.name, ' – ', 1) = split_part(s.name, ' – ', 1))::int as total,
            (select count(*) from schools t where t.level = 'higher'
               and split_part(t.name, ' – ', 1) = split_part(s.name, ' – ', 1)
               and t.city_norm = s.city_norm)::int as here
          from schools s
          where s.level = 'higher' and s.name_norm ~ '(^| )universite'
            and (s.city_norm = ${c}
                 or (s.city_norm like ${c} || ' %' and not exists (select 1 from schools x where x.city_norm = ${c})))
          order by length(s.name), s.uai`,
    )
    const byInstitution = new Map<string, typeof found>()
    for (const r of found) {
      const key = institutionKey(r.name)
      byInstitution.set(key, [...(byInstitution.get(key) ?? []), r])
    }
    const ranked = [...byInstitution.values()]
      .map((sites) => ({
        sites,
        here: sites.length,
        share: (sites[0]?.here ?? 0) / Math.max(1, sites[0]?.total ?? 1),
      }))
      .sort((a, b) => b.here - a.here || b.share - a.share)
    const [best, second] = ranked
    if (!best) return null
    // Several institutions: the one with at least twice the sites here, or else the one whose
    // sites are mostly here (the Maine's, not the outpost of the university of Nantes).
    if (second && best.here < 2 * second.here) {
      const byShare = [...ranked].sort((a, b) => b.share - a.share)
      const [top, next] = byShare
      return top && next && top.share - next.share >= 0.25 ? (top.sites[0] ?? null) : null
    }
    return best.sites[0] ?? null
  }

  /**
   * No city cited: among the schools of exactly that name, the one whose city the article
   * mentions. Several cities mentioned, or none, leave it to staff.
   */
  async byContext(name: string, hint: string): Promise<SchoolCandidate | null> {
    const found = (await this.candidates(name, null, 20)).filter((c) => c.nameScore >= 0.75)
    const haystack = ` ${normalizeWords(hint).join(' ')} `
    const mentioned = found.filter((c) => {
      const city = normalizeWords(c.city).join(' ')
      return city !== '' && haystack.includes(` ${city} `)
    })
    return onlyOne(mentioned, levelOfName(name))
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

const weakWords = sql.raw(`array[${WEAK_NAME_WORDS.map((w) => `'${w}'`).join(',')}]::text[]`)

/** City similarity of the candidate query: trigram, or 0.9 when one name contains the other. */
const cityScore = sql`greatest(similarity(q.c, s.city_norm),
  case when s.city_norm like q.c || ' %' or q.c like s.city_norm || ' %' then 0.9 else 0 end)`

/**
 * Every word of the school's name is in the citation ("Auguste-Brizeux" for "Lycée Brizeux"). Not
 * when the name is only a kind of place ("école", "institut") or only the city's own name
 * ("Université d'Angers"): those words say nothing about which school is meant.
 */
const containsName = sql`s.core <> '' and not (string_to_array(s.core, ' ') <@ string_to_array(s.core_city, ' '))
  and not (string_to_array(s.core, ' ') <@ ${weakWords})
  and string_to_array(s.core, ' ') <@ string_to_array(q.n, ' ')`

/**
 * The only school of a list, once the cited level is preferred and the sites of one university
 * are counted as one. Two different schools mean an ambiguity: nothing is chosen.
 */
function onlyOne(found: SchoolCandidate[], level: SchoolLevel): SchoolCandidate | null {
  const ofLevel = found.filter((c) => c.level === level)
  const pool = ofLevel.length > 0 ? ofLevel : found
  const keys = new Set(pool.map((c) => (c.level === 'higher' ? institutionKey(c.name) : c.uai)))
  return keys.size === 1 ? (pool[0] ?? null) : null
}
