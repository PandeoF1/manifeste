-- Niveaux de confiance (juge Jev) : confirmé, mobilisation signalée, non retenu, non jugé.
--
-- Tout est derrière un réglage, « judge_tiers » (off par défaut) : réglage à « off », rien ne change,
-- ni dans la carte ni dans les chiffres. À « on », un signalement dont l'avis du juge ne dit pas
-- « bloqué ou fermé » ne compte plus dans la vue du direct, les périodes, l'historique ni les
-- données ouvertes. Les signalements de type « mobilisation » (rassemblement, incident, cas pas clair)
-- restent visibles à part (vue school_mobilisation_status) ; les « non retenus » sont gardés en base.
-- Rien n'est supprimé ni modifié : repasser le réglage à « off » rétablit tout.
--
--   confirme    : signalement sur place, ou score ≥ judge_keep avec la nature blocage ou fermé
--                 (pour un statut « levé », le score seul suffit) ;
--   mobilise    : score ≥ judge_keep avec une autre nature, score entre judge_low et judge_keep,
--                 ou score faible avec la nature rassemblement ou incident ;
--   non-retenu  : score faible, autre nature (récit, aperçu, mauvais établissement) ;
--   non-juge    : pas d'avis (article illisible) : compté comme avant.

insert into public.app_settings (key, value) values
  ('judge_tiers', 'off'), ('judge_keep', '0.5'), ('judge_low', '0.3')
on conflict (key) do nothing;

create or replace function public.judge_tiers_on()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((select value from public.app_settings where key = 'judge_tiers'), 'off') = 'on'
$$;
grant execute on function public.judge_tiers_on() to anon, authenticated;

create or replace function public.report_tier(r public.reports)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  with t as (
    select
      coalesce((select value::numeric from public.app_settings
                where key = 'judge_keep' and value ~ '^[0-9.]+$'), 0.5) as keep,
      coalesce((select value::numeric from public.app_settings
                where key = 'judge_low' and value ~ '^[0-9.]+$'), 0.3) as low
  )
  select case
    when r.source_type = 'utilisateur' then 'confirme'
    when r.judge_score is null then 'non-juge'
    when r.judge_score >= t.keep then
      case when r.status = 'leve' or r.judge_nature in ('blocage', 'ferme') then 'confirme' else 'mobilise' end
    when r.judge_score >= t.low then 'mobilise'
    when r.judge_nature in ('rassemblement', 'incident') then 'mobilise'
    else 'non-retenu'
  end
  from t
$$;
grant execute on function public.report_tier(public.reports) to anon, authenticated;

/** Le signalement compte-t-il dans les chiffres ? Toujours si les niveaux sont coupés. */
create or replace function public.report_counts(r public.reports)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select not public.judge_tiers_on() or public.report_tier(r) in ('confirme', 'non-juge')
$$;
grant execute on function public.report_counts(public.reports) to anon, authenticated;

create or replace view public.school_current_status
with (security_invoker = true)
as
with active as (
  select r.*
  from public.reports r
  where r.moderation = 'validated'
    and not r.hidden
    and public.report_counts(r)
    and r.observed_at > now() - make_interval(hours => public.setting_int('status_ttl_hours', 5))
    and r.observed_at <= now() + interval '10 minutes'
),
latest as (
  select distinct on (a.school_uai)
    a.school_uai, a.status, a.observed_at
  from active a
  order by a.school_uai, a.observed_at desc, a.created_at desc
),
counts as (
  select a.school_uai,
         count(distinct coalesce(public.report_source_key(a.source_id, a.source_domain), 'usr:' || a.id::text)) as source_count
  from active a
  group by a.school_uai
)
select
  s.uai,
  s.name,
  s.city,
  s.department,
  s.academy,
  extensions.st_y(s.location::extensions.geometry) as lat,
  extensions.st_x(s.location::extensions.geometry) as lng,
  l.status,
  l.observed_at as last_signal_at,
  c.source_count::int as source_count,
  s.level
from latest l
join public.schools s on s.uai = l.school_uai
join counts c on c.school_uai = l.school_uai;

create or replace function public.school_status_since(p_since timestamptz)
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
      and public.report_counts(r)
      and r.observed_at > greatest(p_since, now() - interval '366 days')
      and r.observed_at <= now() + interval '10 minutes'
  ),
  agg as (
    select p.school_uai,
           (array_agg(p.status order by case p.status when 'bloque' then 0 when 'filtrant' then 1 else 2 end))[1] as status,
           max(p.observed_at) as last_signal_at,
           count(distinct public.report_source_key(p.source_id, p.source_domain))::int as source_count,
           count(distinct (p.observed_at at time zone 'Europe/Paris')::date)
             filter (where p.status <> 'leve')::int as signal_days
    from period p
    group by p.school_uai
  )
  select s.uai, s.name, s.city, s.department, s.academy,
         extensions.st_y(s.location::extensions.geometry),
         extensions.st_x(s.location::extensions.geometry),
         a.status, a.last_signal_at, a.source_count, a.signal_days, s.level
  from agg a
  join public.schools s on s.uai = a.school_uai
  order by a.last_signal_at desc
$$;
grant execute on function public.school_status_since(timestamptz) to anon, authenticated;

create or replace function public.timeline_events(p_since timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with ev as (
    select r.school_uai, r.status, r.observed_at, r.created_at,
           coalesce(public.report_source_key(r.source_id, r.source_domain), 'usr:' || r.id::text) as source_key
    from public.reports r
    where r.moderation = 'validated'
      and not r.hidden
      and public.report_counts(r)
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
        'k', e.source_key
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
        count(distinct r.school_uai) filter (where r.source_type = 'utilisateur' and r.status in ('bloque', 'filtrant')) as via_signalements_sur_place
      from jours j
      left join r on r.jour = j.jour
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
        coalesce(m.filtrants_maintenant, 0) as filtrants_maintenant
      from r
      left join maintenant m on m.zone = r.zone
      where r.zone is not null
      group by r.zone, m.bloques_maintenant, m.filtrants_maintenant
      having count(distinct r.school_uai) filter (where r.status in ('bloque', 'filtrant')) > 0
    ) t;

  elsif p_view = 'etablissements' then
    with r as (
      select rp.school_uai, rp.status, rp.source_type, rp.source_domain, rp.observed_at
      from public.reports rp
      where rp.moderation = 'validated' and not rp.hidden and rp.observed_at <= now()
        and public.report_counts(rp)
    ),
    agg as (
      select school_uai,
        count(*) as signalements,
        count(distinct source_domain) filter (where source_type <> 'utilisateur') as sites_sources,
        string_agg(distinct source_type::text, ' ' order by source_type::text) as origines,
        min(observed_at) filter (where status in ('bloque', 'filtrant')) as premier_blocage,
        max(observed_at) as dernier_signalement
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
        rp.certainty as certitude
      from public.reports rp
      join public.schools s on s.uai = rp.school_uai
      where rp.moderation = 'validated' and not rp.hidden and rp.observed_at <= now()
        and public.report_counts(rp)
    ) t;

  else
    raise exception 'vue inconnue' using errcode = '22023';
  end if;

  return v_out;
end;
$$;
revoke execute on function public.open_data(text) from public;
grant execute on function public.open_data(text) to anon, authenticated;


-- Mobilisation signalée : établissements dont les signalements actifs sont tous « pas clair »
-- (rassemblement, incident…). Vide tant que les niveaux sont coupés.
create or replace view public.school_mobilisation_status
with (security_invoker = true)
as
with active as (
  select r.*
  from public.reports r
  where r.moderation = 'validated'
    and not r.hidden
    and r.status <> 'leve'
    and r.observed_at > now() - make_interval(hours => public.setting_int('status_ttl_hours', 5))
    and r.observed_at <= now() + interval '10 minutes'
    and public.judge_tiers_on()
    and public.report_tier(r) = 'mobilise'
),
latest as (
  select distinct on (a.school_uai)
    a.school_uai, a.status, a.observed_at
  from active a
  order by a.school_uai, a.observed_at desc, a.created_at desc
),
counts as (
  select a.school_uai,
         count(distinct coalesce(public.report_source_key(a.source_id, a.source_domain), 'usr:' || a.id::text)) as source_count
  from active a
  group by a.school_uai
)
select
  s.uai,
  s.name,
  s.city,
  s.department,
  s.academy,
  extensions.st_y(s.location::extensions.geometry) as lat,
  extensions.st_x(s.location::extensions.geometry) as lng,
  l.status,
  l.observed_at as last_signal_at,
  c.source_count::int as source_count,
  s.level
from latest l
join public.schools s on s.uai = l.school_uai
join counts c on c.school_uai = l.school_uai
where not exists (select 1 from public.school_current_status cs where cs.uai = l.school_uai);
grant select on public.school_mobilisation_status to anon, authenticated;

create or replace function public.admin_set_setting(p_key text, p_value text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'réservé aux administrateurs' using errcode = '42501';
  end if;
  case p_key
    when 'status_ttl_hours' then
      if not coalesce(case when p_value ~ '^\d{1,3}$' then p_value::int between 1 and 168 end, false) then
        raise exception 'Durée du direct : entre 1 et 168 heures.' using errcode = '22023';
      end if;
    when 'concordance_window_hours' then
      if not coalesce(case when p_value ~ '^\d{1,2}$' then p_value::int between 1 and 24 end, false) then
        raise exception 'Fenêtre de concordance : entre 1 et 24 heures.' using errcode = '22023';
      end if;
    when 'movement_start' then
      if not coalesce(case when p_value ~ '^\d{4}-\d{2}-\d{2}$' then
           p_value::date between date '2020-01-01' and (now() at time zone 'Europe/Paris')::date end, false) then
        raise exception 'Début du mouvement : une date passée (AAAA-MM-JJ).' using errcode = '22023';
      end if;
    when 'judge_tiers' then
      if p_value not in ('on', 'off') then
        raise exception 'Niveaux du juge : on ou off.' using errcode = '22023';
      end if;
    when 'judge_keep', 'judge_low' then
      if not coalesce(case when p_value ~ '^(0(\.\d{1,2})?|1)$' then p_value::numeric between 0.05 and 1 end, false) then
        raise exception 'Seuil du juge : un nombre entre 0,05 et 1.' using errcode = '22023';
      end if;
    else
      raise exception 'Réglage inconnu : %', p_key using errcode = '22023';
  end case;
  insert into public.app_settings (key, value) values (p_key, p_value)
  on conflict (key) do update set value = excluded.value;
end
$$;
revoke execute on function public.admin_set_setting(text, text) from public, anon;
grant execute on function public.admin_set_setting(text, text) to authenticated;
