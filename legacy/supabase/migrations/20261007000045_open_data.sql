-- Données ouvertes : page « Données » et exports (CSV, JSON, GeoJSON).
--
-- La fonction lit uniquement ce que la carte publique peut déjà lire (signalements validés et
-- non masqués, établissements) : elle tourne avec les droits de l'appelant (security invoker),
-- les règles d'accès de la base continuent donc de s'appliquer. Aucun nom, aucune photo, aucune
-- position d'utilisateur : le lien de la source n'est donné que pour les sources publiques
-- (presse, organisations, sources collectées), jamais pour un signalement sur place.
--
-- Vues : resume, jours, departements, academies, etablissements, signalements.
-- Les jours sont ceux du fait (heure de Paris), pas ceux de la collecte.

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
    ) t;

  else
    raise exception 'vue inconnue' using errcode = '22023';
  end if;

  return v_out;
end;
$$;

revoke execute on function public.open_data(text) from public;
grant execute on function public.open_data(text) to anon, authenticated;
