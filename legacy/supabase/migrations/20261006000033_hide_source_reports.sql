-- Masquer une source : tous ses signaux (passés et à venir) disparaissent du site public
-- (carte, liste, compteurs, aperçus, sitemap) sans être supprimés. Réafficher la source les
-- remet tels quels. Indépendant de « enabled » (collecte), qui ne touche pas aux signaux.

alter table public.scrape_sources add column reports_hidden boolean not null default false;
alter table public.reports add column hidden boolean not null default false;
create index reports_hidden_idx on public.reports (source_id) where hidden;

-- Un signal hérite de l'état de sa source (à la création ou si sa source change).
create or replace function public.reports_inherit_source_hidden()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source_id is not null then
    new.hidden := coalesce(
      (select s.reports_hidden from public.scrape_sources s where s.id = new.source_id), false);
  end if;
  return new;
end;
$$;
create trigger reports_inherit_source_hidden
  before insert or update of source_id on public.reports
  for each row execute function public.reports_inherit_source_hidden();

-- Masquer / réafficher une source se répercute sur tous ses signaux.
create or replace function public.sources_propagate_hidden()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.reports set hidden = new.reports_hidden
  where source_id = new.id and hidden is distinct from new.reports_hidden;
  return null;
end;
$$;
create trigger sources_propagate_hidden
  after update of reports_hidden on public.scrape_sources
  for each row when (old.reports_hidden is distinct from new.reports_hidden)
  execute function public.sources_propagate_hidden();

revoke execute on function public.reports_inherit_source_hidden() from public, anon, authenticated;
revoke execute on function public.sources_propagate_hidden() from public, anon, authenticated;

-- Lecture publique : signaux validés et non masqués.
drop policy "lecture publique des reports validés" on public.reports;
create policy "lecture publique des reports validés" on public.reports
  for select using (moderation = 'validated' and not hidden);

-- Statut en direct (même définition, signaux masqués exclus : aussi pour l'admin sur la carte).
create or replace view public.school_current_status
with (security_invoker = true)
as
with active as (
  select r.*
  from public.reports r
  where r.moderation = 'validated'
    and not r.hidden
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
  c.source_count::int as source_count
from latest l
join public.schools s on s.uai = l.school_uai
join counts c on c.school_uai = l.school_uai;

create or replace function public.school_status_since(p_since timestamptz)
returns table (
  uai text, name text, city text, department text, academy text,
  lat double precision, lng double precision,
  status public.report_status, last_signal_at timestamptz, source_count int, signal_days int
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
      -- Au plus un an en arrière, et pas de signal daté dans le futur.
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
         a.status, a.last_signal_at, a.source_count, a.signal_days
  from agg a
  join public.schools s on s.uai = a.school_uai
  order by a.last_signal_at desc
$$;

-- Admin : nombre de signaux (validés) par source, et combien sont masqués.
create or replace function public.admin_source_report_counts()
returns table (source_id uuid, total integer, hidden integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return query
    select r.source_id, count(*)::int, count(*) filter (where r.hidden)::int
    from public.reports r
    where r.source_id is not null and r.moderation = 'validated'
    group by r.source_id;
end;
$$;
revoke execute on function public.admin_source_report_counts() from public, anon;
grant execute on function public.admin_source_report_counts() to authenticated;
