/**
 * The six open-data views, computed on the fly (a few thousand reports: milliseconds) and cached
 * for a short time. Output keeps the French contract of the legacy API (names and values:
 * "bloque", "lycee", "presse"…); the schema it reads is English.
 */
import { sql, type SQL } from 'drizzle-orm'
import type { Database } from '@manifeste/db'
import { memoWithTtl } from '../../lib/memo.ts'
import { rows } from '../../lib/sql.ts'
import type { SettingsService } from '../settings/service.ts'
import type { StatusesService } from '../statuses/service.ts'
import type { Row, View } from './format.ts'

const CACHE_MS = 60_000

const FR_STATUS = (col: string) =>
  sql.raw(
    `case ${col} when 'blocked' then 'bloque' when 'filtering' then 'filtrant' else 'leve' end`,
  )
const FR_LEVEL = (col: string) =>
  sql.raw(`case ${col} when 'secondary' then 'lycee' else 'superieur' end`)
const FR_ORIGIN = (col: string) =>
  sql.raw(
    `case ${col} when 'press' then 'presse' when 'union' then 'syndicat' when 'aggregator' then 'collecteur' else 'utilisateur' end`,
  )
const FR_CERTAINTY = (col: string) =>
  sql.raw(
    `case ${col} when 'high' then 'haute' when 'medium' then 'moyenne' when 'low' then 'faible' end`,
  )
const DAY = (col: string) => sql.raw(`(${col} at time zone 'Europe/Paris')::date`)

type Json = Record<string, unknown>

export class OpenDataService {
  private readonly cache = memoWithTtl(CACHE_MS, (view: View) => this.compute(view))

  constructor(
    private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly statuses: StatusesService,
  ) {}

  get(view: View): Promise<Json | Row[]> {
    return this.cache.get(view)
  }

  private async compute(view: View): Promise<Json | Row[]> {
    const { judge_tiers: tiersOn } = await this.settings.all()
    switch (view) {
      case 'resume':
        return this.summary(tiersOn)
      case 'jours':
        return this.days(tiersOn)
      case 'departements':
        return this.zones('department', tiersOn)
      case 'academies':
        return this.zones('academy', tiersOn)
      case 'etablissements':
        return this.schools(tiersOn)
      case 'signalements':
        return this.reports(tiersOn)
    }
  }

  /** Reports that count (not hidden, validated, not in the future). */
  private counted(tiersOn: boolean): SQL {
    return sql`rp.moderation = 'approved' and not rp.hidden and rp.observed_at <= now()
      and (not ${tiersOn}::boolean or rp.tier in ('confirmed', 'unjudged'))`
  }

  /** Reports shown as such: counted ones, plus reported mobilisations when tiers are on. */
  private listed(tiersOn: boolean): SQL {
    return sql`rp.moderation = 'approved' and not rp.hidden and rp.observed_at <= now()
      and (not ${tiersOn}::boolean or rp.tier in ('confirmed', 'unjudged')
           or (rp.status <> 'lifted' and rp.tier = 'mobilisation'))`
  }

  private async summary(tiersOn: boolean): Promise<Json> {
    const base = sql`
      select rp.school_uai, rp.status, rp.origin, rp.source_domain, rp.observed_at,
             ${DAY('rp.observed_at')} as day, s.department, s.level
      from reports rp join schools s on s.uai = rp.school_uai
      where ${this.counted(tiersOn)}`
    const [[totals], peak, origins, mobilised, live] = await Promise.all([
      rows<{
        firstDay: string | null
        lastDay: string | null
        reports: number
        schools: number
        departments: number
        universities: number
        sources: number
      }>(
        this.db,
        sql`with r as (${base})
          select to_char(min(day), 'YYYY-MM-DD') as "firstDay", to_char(max(day), 'YYYY-MM-DD') as "lastDay",
            count(*)::int as reports,
            count(distinct school_uai) filter (where status <> 'lifted')::int as schools,
            count(distinct department) filter (where status <> 'lifted')::int as departments,
            count(distinct school_uai) filter (where level = 'higher' and status <> 'lifted')::int as universities,
            count(distinct source_domain) filter (where origin <> 'on_site')::int as sources
          from r`,
      ),
      rows<{ jour: string; etablissements: number; departements: number }>(
        this.db,
        sql`with r as (${base})
          select to_char(day, 'YYYY-MM-DD') as jour,
            count(distinct school_uai) filter (where status <> 'lifted')::int as etablissements,
            count(distinct department) filter (where status <> 'lifted')::int as departements
          from r group by day order by 2 desc, day desc limit 1`,
      ),
      rows<{ origine: string; signalements: number; etablissements: number }>(
        this.db,
        sql`with r as (${base})
          select ${FR_ORIGIN('origin')} as origine, count(*)::int as signalements,
                 count(distinct school_uai)::int as etablissements
          from r group by origin order by 2 desc`,
      ),
      tiersOn
        ? rows<{ n: number }>(
            this.db,
            sql`with r as (${base})
              select count(distinct rp.school_uai)::int as n from reports rp
              where rp.moderation = 'approved' and not rp.hidden and rp.observed_at <= now()
                and rp.status <> 'lifted' and rp.tier = 'mobilisation'
                and rp.school_uai not in (select school_uai from r)`,
          )
        : Promise.resolve([{ n: 0 }]),
      this.statuses.current('live'),
    ])
    return {
      genere_le: new Date().toISOString(),
      premier_jour: totals?.firstDay ?? null,
      dernier_jour: totals?.lastDay ?? null,
      signalements: totals?.reports ?? 0,
      // Schools with only a reported mobilisation (unclear), outside the counts above.
      mobilises: mobilised[0]?.n ?? 0,
      etablissements: totals?.schools ?? 0,
      departements: totals?.departments ?? 0,
      facs: totals?.universities ?? 0,
      sites_sources: totals?.sources ?? 0,
      pic: peak[0] ?? null,
      en_ce_moment: {
        bloques: live.filter((s) => s.status === 'blocked').length,
        filtrants: live.filter((s) => s.status === 'filtering').length,
      },
      origines: origins,
    }
  }

  private days(tiersOn: boolean): Promise<Row[]> {
    return rows<Row>(
      this.db,
      sql`with r as (
          select rp.school_uai, rp.status, rp.origin, ${DAY('rp.observed_at')} as day, s.department, s.level
          from reports rp join schools s on s.uai = rp.school_uai
          where ${this.counted(tiersOn)}
        ),
        days as (
          select g::date as day from generate_series((select min(day) from r), (select max(day) from r), interval '1 day') g
        ),
        mob as (
          select ${DAY('rp.observed_at')} as day, rp.school_uai, s.level
          from reports rp join schools s on s.uai = rp.school_uai
          where rp.moderation = 'approved' and not rp.hidden and rp.observed_at <= now()
            and rp.status <> 'lifted' and ${tiersOn}::boolean and rp.tier = 'mobilisation'
        ),
        mobs as (
          select m.day, count(distinct m.school_uai)::int as n,
                 count(distinct m.school_uai) filter (where m.level = 'secondary')::int as secondary,
                 count(distinct m.school_uai) filter (where m.level = 'higher')::int as higher
          from mob m
          where not exists (select 1 from r where r.school_uai = m.school_uai and r.day = m.day and r.status <> 'lifted')
          group by m.day
        )
        select to_char(d.day, 'YYYY-MM-DD') as jour,
          count(distinct r.school_uai) filter (where r.status <> 'lifted')::int as etablissements,
          count(distinct r.school_uai) filter (where r.status = 'blocked')::int as bloques,
          count(distinct r.school_uai) filter (where r.status = 'filtering')::int as filtrants,
          count(distinct r.school_uai) filter (where r.status = 'lifted')::int as leves,
          count(distinct r.department) filter (where r.status <> 'lifted')::int as departements,
          count(distinct r.school_uai) filter (where r.level = 'secondary' and r.status <> 'lifted')::int as lycees,
          count(distinct r.school_uai) filter (where r.level = 'higher' and r.status <> 'lifted')::int as facs,
          count(r.school_uai)::int as signalements,
          count(distinct r.school_uai) filter (where r.origin = 'press' and r.status <> 'lifted')::int as via_presse,
          count(distinct r.school_uai) filter (where r.origin = 'union' and r.status <> 'lifted')::int as via_organisations,
          count(distinct r.school_uai) filter (where r.origin = 'aggregator' and r.status <> 'lifted')::int as via_autres_sources,
          count(distinct r.school_uai) filter (where r.origin = 'on_site' and r.status <> 'lifted')::int as via_signalements_sur_place,
          coalesce(max(ms.n), 0)::int as mobilises,
          coalesce(max(ms.secondary), 0)::int as mobilises_lycees,
          coalesce(max(ms.higher), 0)::int as mobilises_facs
        from days d
        left join r on r.day = d.day
        left join mobs ms on ms.day = d.day
        group by d.day order by d.day`,
    )
  }

  private async zones(column: 'department' | 'academy', tiersOn: boolean): Promise<Row[]> {
    const zone = sql.raw(`s.${column}`)
    const live = await this.statuses.current('live')
    const nowByZone = new Map<string, { blocked: number; filtering: number }>()
    for (const s of live) {
      const z = s[column]
      if (!z) continue
      const cur = nowByZone.get(z) ?? { blocked: 0, filtering: 0 }
      if (s.status === 'blocked') cur.blocked++
      if (s.status === 'filtering') cur.filtering++
      nowByZone.set(z, cur)
    }
    const found = await rows<Row & { zone: string }>(
      this.db,
      sql`with r as (
          select rp.school_uai, rp.status, ${DAY('rp.observed_at')} as day, ${zone} as zone, s.level
          from reports rp join schools s on s.uai = rp.school_uai
          where ${this.counted(tiersOn)}
        ),
        mz as (
          select ${zone} as zone, count(distinct rp.school_uai)::int as n
          from reports rp join schools s on s.uai = rp.school_uai
          where rp.moderation = 'approved' and not rp.hidden and rp.observed_at <= now()
            and rp.status <> 'lifted' and ${tiersOn}::boolean and rp.tier = 'mobilisation'
            and rp.school_uai not in (select school_uai from r where status <> 'lifted')
          group by 1
        )
        select r.zone,
          count(distinct r.school_uai) filter (where r.status <> 'lifted')::int as etablissements,
          count(distinct r.school_uai) filter (where r.level = 'secondary' and r.status <> 'lifted')::int as lycees,
          count(distinct r.school_uai) filter (where r.level = 'higher' and r.status <> 'lifted')::int as facs,
          to_char(min(r.day) filter (where r.status <> 'lifted'), 'YYYY-MM-DD') as premier_jour,
          to_char(max(r.day) filter (where r.status <> 'lifted'), 'YYYY-MM-DD') as dernier_jour,
          count(*)::int as signalements,
          coalesce(max(mz.n), 0)::int as mobilises
        from r left join mz on mz.zone = r.zone
        where r.zone is not null
        group by r.zone
        having count(distinct r.school_uai) filter (where r.status <> 'lifted') > 0
        order by etablissements desc, r.zone`,
    )
    return found.map((row) => ({
      ...row,
      bloques_maintenant: nowByZone.get(row.zone)?.blocked ?? 0,
      filtrants_maintenant: nowByZone.get(row.zone)?.filtering ?? 0,
    }))
  }

  private async schools(tiersOn: boolean): Promise<Row[]> {
    const live = new Map((await this.statuses.current('live')).map((s) => [s.uai, s.status]))
    const found = await rows<Row & { uai: string }>(
      this.db,
      sql`with r as (
          select rp.school_uai, rp.status, rp.origin, rp.source_domain, rp.observed_at, rp.tier
          from reports rp where ${this.listed(tiersOn)}
        ),
        agg as (
          select school_uai,
            count(*)::int as signalements,
            count(distinct source_domain) filter (where origin <> 'on_site')::int as sites_sources,
            string_agg(distinct ${FR_ORIGIN('origin')}, ' ' order by ${FR_ORIGIN('origin')}) as origines,
            min(observed_at) filter (where status <> 'lifted') as premier_blocage,
            max(observed_at) as dernier_signalement,
            case
              when not ${tiersOn}::boolean then null
              when bool_or(tier = 'confirmed' or origin = 'on_site') then 'confirmé'
              when bool_or(tier = 'unjudged') then 'non jugé'
              else 'mobilisation'
            end as confiance
          from r group by school_uai
        ),
        latest as (
          select distinct on (school_uai) school_uai, status as latest_status
          from r order by school_uai, observed_at desc
        )
        select s.uai, s.name as nom, s.city as commune, s.department as departement,
          s.academy as academie, ${FR_LEVEL('s.level')} as niveau,
          round(st_y(s.location::geometry)::numeric, 5)::float8 as lat,
          round(st_x(s.location::geometry)::numeric, 5)::float8 as lng,
          a.signalements, a.sites_sources, a.origines,
          to_char(${DAY('a.premier_blocage')}, 'YYYY-MM-DD') as premier_blocage,
          a.dernier_signalement,
          ${FR_STATUS('l.latest_status')} as dernier_statut,
          a.confiance
        from agg a
        join schools s on s.uai = a.school_uai
        join latest l on l.school_uai = a.school_uai
        where a.premier_blocage is not null
        order by a.premier_blocage nulls last, s.uai`,
    )
    const fr = { blocked: 'bloque', filtering: 'filtrant', lifted: 'leve' } as const
    return found.map((row) => ({
      ...row,
      statut_direct: live.has(row.uai) ? fr[live.get(row.uai) ?? 'lifted'] : null,
    }))
  }

  private reports(tiersOn: boolean): Promise<Row[]> {
    return rows<Row>(
      this.db,
      sql`select rp.observed_at as observe_le, to_char(${DAY('rp.observed_at')}, 'YYYY-MM-DD') as jour,
          s.uai, s.name as nom, s.city as commune, s.department as departement, s.academy as academie,
          ${FR_LEVEL('s.level')} as niveau, ${FR_STATUS('rp.status')} as statut,
          ${FR_ORIGIN('rp.origin')} as origine,
          case when rp.origin = 'on_site' then null else rp.source_domain end as site_source,
          case when rp.origin = 'on_site' then null else rp.source_url end as lien_source,
          ${FR_CERTAINTY('rp.certainty')} as certitude,
          case when ${tiersOn}::boolean then
            case when rp.origin = 'on_site' or rp.tier = 'confirmed' then 'confirmé'
                 when rp.tier = 'unjudged' then 'non jugé' else 'mobilisation' end
          end as confiance
        from reports rp join schools s on s.uai = rp.school_uai
        where ${this.listed(tiersOn)}
        order by rp.observed_at desc, s.uai`,
    )
  }
}
