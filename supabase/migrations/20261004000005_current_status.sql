-- Statut courant par lycée. L'expiration est calculée à la lecture (now()),
-- un lycée sans signal validé depuis status_ttl_hours sort de la vue.
create or replace view public.school_current_status
with (security_invoker = true)
as
with active as (
  select r.*
  from public.reports r
  where r.moderation = 'validated'
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
         count(distinct public.report_source_key(a.source_id, a.source_domain)) as source_count
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

-- Compteur national.
create or replace function public.national_counts()
returns table (bloque int, filtrant int, leve int, last_signal_at timestamptz)
language sql stable
security invoker
set search_path = ''
as $$
  select
    count(*) filter (where status = 'bloque')::int,
    count(*) filter (where status = 'filtrant')::int,
    count(*) filter (where status = 'leve')::int,
    max(last_signal_at)
  from public.school_current_status
$$;
