-- Mobilisation signalée partout : périodes, replay, données ouvertes (niveaux du juge allumés).
--
-- Sans effet tant que le réglage judge_tiers est à « off » (tout est vide ou comme avant).
--   * school_mobilisation_since(p_since) : comme school_status_since, pour les établissements avec
--     seulement une mobilisation signalée sur la période (cartes 24 h, 7 jours, Tout) ;
--   * timeline_events : chaque événement porte « m » (vrai pour une mobilisation signalée), pour le replay ;
--   * open_data : jours (mobilises, mobilises_lycees, mobilises_facs), zones (mobilises) et, dans les exports,
--     les mobilisations avec une colonne « confiance » (confirmé, non jugé, mobilisation ; null niveaux coupés).

/** Libellé de confiance d'un signalement (null quand les niveaux sont coupés). */
create or replace function public.report_confiance(r public.reports)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case when not public.judge_tiers_on() then null
    else case public.report_tier(r)
      when 'confirme' then 'confirmé'
      when 'non-juge' then 'non jugé'
      else 'mobilisation'
    end
  end
$$;
grant execute on function public.report_confiance(public.reports) to anon, authenticated;

/** Le signalement figure-t-il dans les exports ? Compté, ou mobilisation signalée. */
create or replace function public.report_listed(r public.reports)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select public.report_counts(r)
    or (public.judge_tiers_on() and r.status <> 'leve' and public.report_tier(r) = 'mobilise')
$$;
grant execute on function public.report_listed(public.reports) to anon, authenticated;

create or replace function public.school_mobilisation_since(p_since timestamptz)
returns table (
  uai text, name text, city text, department text, academy text,
  lat double precision, lng double precision,
  status public.report_status, last_signal_at timestamptz, source_count int, signal_days int,
  level text
)
language sql stable
security invoker
set search_path = ''
as $$
  with period as (
    select r.*
    from public.reports r
    where r.moderation = 'validated'
      and not r.hidden
      and r.status <> 'leve'
      and public.judge_tiers_on()
      and public.report_tier(r) = 'mobilise'
      and r.observed_at > greatest(p_since, now() - interval '366 days')
      and r.observed_at <= now() + interval '10 minutes'
  ),
  agg as (
    select p.school_uai,
           (array_agg(p.status order by case p.status when 'bloque' then 0 else 1 end))[1] as status,
           max(p.observed_at) as last_signal_at,
           count(distinct public.report_source_key(p.source_id, p.source_domain))::int as source_count,
           count(distinct (p.observed_at at time zone 'Europe/Paris')::date)::int as signal_days
    from period p
    group by p.school_uai
  )
  select s.uai, s.name, s.city, s.department, s.academy,
         extensions.st_y(s.location::extensions.geometry),
         extensions.st_x(s.location::extensions.geometry),
         a.status, a.last_signal_at, a.source_count, a.signal_days, s.level
  from agg a
  join public.schools s on s.uai = a.school_uai
  where a.school_uai not in (select u.uai from public.school_status_since(p_since) u)
  order by a.last_signal_at desc
$$;
grant execute on function public.school_mobilisation_since(timestamptz) to anon, authenticated;

create or replace function public.timeline_events(p_since timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with ev as (
    select r.school_uai, r.status, r.observed_at, r.created_at,
           coalesce(public.report_source_key(r.source_id, r.source_domain), 'usr:' || r.id::text) as source_key,
           -- Mobilisation signalée (niveaux du juge allumés) : à part des signalements comptés.
           not public.report_counts(r) as is_mob
    from public.reports r
    where r.moderation = 'validated'
      and not r.hidden
      and (public.report_counts(r)
           or (public.judge_tiers_on() and r.status <> 'leve' and public.report_tier(r) = 'mobilise'))
      and r.observed_at > greatest(p_since, now() - interval '366 days')
      and r.observed_at <= now() + interval '10 minutes'
  )
  select jsonb_build_object(
    'schools', coalesce((
      select jsonb_agg(jsonb_build_object(
        'uai', s.uai, 'name', s.name, 'city', s.city,
        'department', s.department, 'academy', s.academy,
        'lat', extensions.st_y(s.location::extensions.geometry),
        'lng', extensions.st_x(s.location::extensions.geometry),
        'level', s.level
      ) order by s.uai)
      from public.schools s
      where s.uai in (select school_uai from ev)
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'u', e.school_uai,
        's', e.status,
        't', (extract(epoch from e.observed_at) * 1000)::bigint,
        'k', e.source_key,
        'm', e.is_mob
      ) order by e.observed_at, e.created_at)
      from ev e
    ), '[]'::jsonb)
  )
$$;
grant execute on function public.timeline_events(timestamptz) to anon, authenticated;

create or replace function public.open_data(p_view text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  if p_view = 'resume' then
    with r as (
      select rp.school_uai, rp.status, rp.source_type, rp.source_domain, rp.observed_at,
             (rp.observed_at at time zone 'Europe/Paris')::date as jour,
             s.department, s.level
      from public.reports rp
      join public.schools s on s.uai = rp.school_uai
      where rp.moderation = 'validated' and not rp.hidden and rp.observed_at <= now()
        and public.report_counts(rp)
    ),
    par_jour as (
      select jour,
             count(distinct school_uai) filter (where status in ('bloque', 'filtrant')) as etablissements,
             count(distinct department) filter (where status in ('bloque', 'filtrant')) as departements
      from r group by jour
    ),
    pic as (
      select jour, etablissements, departements from par_jour
      order by etablissements desc, jour desc limit 1
    ),
    origines as (
      select source_type::text as origine, count(*) as signalements,
             count(distinct school_uai) as etablissements
      from r group by source_type
    ),
    maintenant as (
      select count(*) filter (where status = 'bloque') as bloques,
             count(*) filter (where status = 'filtrant') as filtrants
      from public.school_current_status
    )
    select jsonb_build_object(
      'genere_le', now(),
      'premier_jour', (select min(jour) from r),
      'dernier_jour', (select max(jour) from r),
      'signalements', (select count(*) from r),
      -- Établissements avec seulement une mobilisation signalée (pas clair), hors des comptes ci-dessus.
      'mobilises', (
        select count(distinct x.school_uai)
        from public.reports x
        where x.moderation = 'validated' and not x.hidden and x.observed_at <= now()
          and x.status <> 'leve'
          and public.judge_tiers_on() and public.report_tier(x) = 'mobilise'
          and x.school_uai not in (select school_uai from r)
      ),
      'etablissements', (select count(distinct school_uai) from r where status in ('bloque', 'filtrant')),
      'departements', (select count(distinct department) from r where status in ('bloque', 'filtrant')),
      'facs', (select count(distinct school_uai) from r where level = 'superieur' and status in ('bloque', 'filtrant')),
      'sites_sources', (select count(distinct source_domain) from r where source_type <> 'utilisateur'),
      'pic', (select to_jsonb(p) from pic p),
      'en_ce_moment', (select to_jsonb(m) from maintenant m),
      'origines', coalesce((select jsonb_agg(to_jsonb(o) order by o.signalements desc) from origines o), '[]'::jsonb)
    ) into v_out;

  elsif p_view = 'jours' then
    with r as (
      select rp.school_uai, rp.status, rp.source_type, rp.observed_at,
             (rp.observed_at at time zone 'Europe/Paris')::date as jour,
             s.department, s.level
      from public.reports rp
      join public.schools s on s.uai = rp.school_uai
      where rp.moderation = 'validated' and not rp.hidden and rp.observed_at <= now()
        and public.report_counts(rp)
    ),
    jours as (
      select g::date as jour
      from generate_series((select min(jour) from r), (select max(jour) from r), interval '1 day') g
    ),
    -- Mobilisations signalées : établissements du jour sans signalement confirmé ce jour-là.
    mob as (
      select (rp.observed_at at time zone 'Europe/Paris')::date as jour, rp.school_uai, s.level
      from public.reports rp
      join public.schools s on s.uai = rp.school_uai
      where rp.moderation = 'validated' and not rp.hidden and rp.observed_at <= now()
        and rp.status <> 'leve' and public.judge_tiers_on() and public.report_tier(rp) = 'mobilise'
    ),
    mobs as (
      select m.jour,
             count(distinct m.school_uai) as n,
             count(distinct m.school_uai) filter (where m.level = 'lycee') as lycees,
             count(distinct m.school_uai) filter (where m.level = 'superieur') as facs
      from mob m
      where not exists (
        select 1 from r where r.school_uai = m.school_uai and r.jour = m.jour and r.status in ('bloque', 'filtrant')
      )
      group by m.jour
    )
    select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.jour), '[]'::jsonb) into v_out
    from (
      select j.jour,
        count(distinct r.school_uai) filter (where r.status in ('bloque', 'filtrant')) as etablissements,
        count(distinct r.school_uai) filter (where r.status = 'bloque') as bloques,
        count(distinct r.school_uai) filter (where r.status = 'filtrant') as filtrants,
        count(distinct r.school_uai) filter (where r.status = 'leve') as leves,
        count(distinct r.department) filter (where r.status in ('bloque', 'filtrant')) as departements,
        count(distinct r.school_uai) filter (where r.level = 'lycee' and r.status in ('bloque', 'filtrant')) as lycees,
        count(distinct r.school_uai) filter (where r.level = 'superieur' and r.status in ('bloque', 'filtrant')) as facs,
        count(r.school_uai) as signalements,
        count(distinct r.school_uai) filter (where r.source_type = 'presse' and r.status in ('bloque', 'filtrant')) as via_presse,
        count(distinct r.school_uai) filter (where r.source_type = 'syndicat' and r.status in ('bloque', 'filtrant')) as via_organisations,
        count(distinct r.school_uai) filter (where r.source_type = 'collecteur' and r.status in ('bloque', 'filtrant')) as via_autres_sources,
        count(distinct r.school_uai) filter (where r.source_type = 'utilisateur' and r.status in ('bloque', 'filtrant')) as via_signalements_sur_place,
        coalesce(max(ms.n), 0) as mobilises,
        coalesce(max(ms.lycees), 0) as mobilises_lycees,
        coalesce(max(ms.facs), 0) as mobilises_facs
      from jours j
      left join r on r.jour = j.jour
      left join mobs ms on ms.jour = j.jour
      group by j.jour
    ) t;

  elsif p_view in ('departements', 'academies') then
    with r as (
      select rp.school_uai, rp.status, rp.observed_at,
             (rp.observed_at at time zone 'Europe/Paris')::date as jour,
             case when p_view = 'departements' then s.department else s.academy end as zone,
             s.level
      from public.reports rp
      join public.schools s on s.uai = rp.school_uai
      where rp.moderation = 'validated' and not rp.hidden and rp.observed_at <= now()
        and public.report_counts(rp)
    ),
    maintenant as (
      select case when p_view = 'departements' then department else academy end as zone,
             count(*) filter (where status = 'bloque') as bloques_maintenant,
             count(*) filter (where status = 'filtrant') as filtrants_maintenant
      from public.school_current_status group by 1
    ),
    -- Établissements avec seulement une mobilisation signalée, par zone.
    mz as (
      select case when p_view = 'departements' then s.department else s.academy end as zone,
             count(distinct rp.school_uai) as n
      from public.reports rp
      join public.schools s on s.uai = rp.school_uai
      where rp.moderation = 'validated' and not rp.hidden and rp.observed_at <= now()
        and rp.status <> 'leve' and public.judge_tiers_on() and public.report_tier(rp) = 'mobilise'
        and rp.school_uai not in (select school_uai from r where status in ('bloque', 'filtrant'))
      group by 1
    )
    select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.etablissements desc, t.zone), '[]'::jsonb) into v_out
    from (
      select r.zone,
        count(distinct r.school_uai) filter (where r.status in ('bloque', 'filtrant')) as etablissements,
        count(distinct r.school_uai) filter (where r.level = 'lycee' and r.status in ('bloque', 'filtrant')) as lycees,
        count(distinct r.school_uai) filter (where r.level = 'superieur' and r.status in ('bloque', 'filtrant')) as facs,
        min(r.jour) filter (where r.status in ('bloque', 'filtrant')) as premier_jour,
        max(r.jour) filter (where r.status in ('bloque', 'filtrant')) as dernier_jour,
        count(*) as signalements,
        coalesce(m.bloques_maintenant, 0) as bloques_maintenant,
        coalesce(m.filtrants_maintenant, 0) as filtrants_maintenant,
        coalesce(mz.n, 0) as mobilises
      from r
      left join maintenant m on m.zone = r.zone
      left join mz on mz.zone = r.zone
      where r.zone is not null
      group by r.zone, m.bloques_maintenant, m.filtrants_maintenant, mz.n
      having count(distinct r.school_uai) filter (where r.status in ('bloque', 'filtrant')) > 0
    ) t;

  elsif p_view = 'etablissements' then
    with r as (
      select rp.school_uai, rp.status, rp.source_type, rp.source_domain, rp.observed_at,
             public.report_confiance(rp) as confiance
      from public.reports rp
      where rp.moderation = 'validated' and not rp.hidden and rp.observed_at <= now()
        and public.report_listed(rp)
    ),
    agg as (
      select school_uai,
        count(*) as signalements,
        count(distinct source_domain) filter (where source_type <> 'utilisateur') as sites_sources,
        string_agg(distinct source_type::text, ' ' order by source_type::text) as origines,
        min(observed_at) filter (where status in ('bloque', 'filtrant')) as premier_blocage,
        max(observed_at) as dernier_signalement,
        -- Confirmé si au moins un signalement l'est ; « mobilisation » si tous le sont ; null niveaux coupés.
        case
          when bool_or(confiance is null) then null
          when bool_or(confiance = 'confirmé') then 'confirmé'
          when bool_or(confiance = 'non jugé') then 'non jugé'
          else 'mobilisation'
        end as confiance
      from r group by school_uai
    ),
    dernier as (
      select distinct on (school_uai) school_uai, status as dernier_statut
      from r order by school_uai, observed_at desc
    )
    select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.premier_blocage nulls last, t.uai), '[]'::jsonb) into v_out
    from (
      select s.uai, s.name as nom, s.city as commune, s.department as departement,
        s.academy as academie, s.level as niveau,
        round(extensions.st_y(s.location::extensions.geometry)::numeric, 5) as lat,
        round(extensions.st_x(s.location::extensions.geometry)::numeric, 5) as lng,
        a.signalements, a.sites_sources, a.origines,
        (a.premier_blocage at time zone 'Europe/Paris')::date as premier_blocage,
        a.dernier_signalement,
        d.dernier_statut,
        a.confiance,
        c.status as statut_direct
      from agg a
      join public.schools s on s.uai = a.school_uai
      join dernier d on d.school_uai = a.school_uai
      left join public.school_current_status c on c.uai = a.school_uai
      where a.premier_blocage is not null
    ) t;

  elsif p_view = 'signalements' then
    select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.observe_le desc, t.uai), '[]'::jsonb) into v_out
    from (
      select rp.observed_at as observe_le,
        (rp.observed_at at time zone 'Europe/Paris')::date as jour,
        s.uai, s.name as nom, s.city as commune, s.department as departement,
        s.academy as academie, s.level as niveau,
        rp.status as statut,
        rp.source_type::text as origine,
        case when rp.source_type = 'utilisateur' then null else rp.source_domain end as site_source,
        case when rp.source_type = 'utilisateur' then null else rp.source_url end as lien_source,
        rp.certainty as certitude,
        public.report_confiance(rp) as confiance
      from public.reports rp
      join public.schools s on s.uai = rp.school_uai
      where rp.moderation = 'validated' and not rp.hidden and rp.observed_at <= now()
        and public.report_listed(rp)
    ) t;

  else
    raise exception 'vue inconnue' using errcode = '22023';
  end if;

  return v_out;
end;
$$;
revoke execute on function public.open_data(text) from public;
grant execute on function public.open_data(text) to anon, authenticated;
