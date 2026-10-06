-- Enseignement supérieur : facs, IUT, écoles sont dans la même table que les lycées (un seul
-- mouvement : même carte, même liste, même modération). `level` ne sert qu'à nommer
-- l'établissement (« lycée » ou « établissement ») et à ajuster le matching.
alter table public.schools
  add column level text not null default 'lycee' check (level in ('lycee', 'superieur'));
create index schools_level_idx on public.schools (level);

-- Mots sans valeur d'identification : on y ajoute ceux des facs.
create or replace function public.strip_generic_words(p text)
returns text
language sql immutable
set search_path = ''
as $$
  select trim(regexp_replace(
    regexp_replace(
      public.normalize_text(p),
      '\m(lycee|lycees|lp|lgt|lpo|general|generale|polyvalent|professionnel|technologique|public|prive|universite|universites|fac|faculte|iut|ufr|campus|site|des|du|de|la|le|les|l|d|et|a)\M',
      ' ', 'g'),
    '\s+', ' ', 'g'))
$$;

-- Vue du statut courant : même définition, plus `level`.
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
  c.source_count::int as source_count,
  s.level
from latest l
join public.schools s on s.uai = l.school_uai
join counts c on c.school_uai = l.school_uai;

drop function public.school_status_since(timestamptz);
create function public.school_status_since(p_since timestamptz)
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

drop function public.school_detail(text);
create function public.school_detail(p_uai text)
returns table (
  uai text, name text, city text, postcode text, department text, academy text, kind text,
  lat double precision, lng double precision, level text
)
language sql stable
security invoker
set search_path = ''
as $$
  select s.uai, s.name, s.city, s.postcode, s.department, s.academy, s.kind,
         extensions.st_y(s.location::extensions.geometry), extensions.st_x(s.location::extensions.geometry),
         s.level
  from public.schools s
  where s.uai = p_uai
$$;
grant execute on function public.school_detail(text) to anon, authenticated;

drop function public.nearby_schools(double precision, double precision, integer);
create function public.nearby_schools(p_lat double precision, p_lng double precision, p_radius_m integer default 2000)
returns table (uai text, name text, city text, distance_m integer, level text)
language sql stable
security invoker
set search_path = ''
as $$
  select s.uai, s.name, s.city,
         round(extensions.st_distance(s.location, extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography))::int,
         s.level
  from public.schools s
  where s.location is not null
    and extensions.st_dwithin(s.location, extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography, least(greatest(p_radius_m, 100), 5000))
  order by 4
  limit 15
$$;
grant execute on function public.nearby_schools(double precision, double precision, integer) to anon, authenticated;

drop function public.search_schools(text);
create function public.search_schools(p_query text)
returns table (uai text, name text, city text, department text, level text)
language sql stable
security invoker
set search_path = ''
as $$
  with q as (select public.normalize_text(p_query) as t)
  select s.uai, s.name, s.city, s.department, s.level
  from public.schools s, q
  where length(q.t) >= 2
    and (s.name_norm || ' ' || s.city_norm) like '%' || replace(q.t, ' ', '%') || '%'
  order by extensions.word_similarity(q.t, s.name_norm || ' ' || s.city_norm) desc, s.name
  limit 15
$$;
grant execute on function public.search_schools(text) to anon, authenticated;

-- Un établissement ajouté à la main (proposition d'un visiteur) dont le nom parle de fac est rangé
-- au niveau supérieur ; l'import des lycées, lui, n'a aucun nom de ce genre.
create or replace function public.schools_infer_level()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.level = 'lycee'
     and public.normalize_text(new.name) ~ '\m(universite|universites|fac|faculte|iut|ufr|campus)\M'
     and public.normalize_text(new.name) !~ '\mlycee\M' then
    new.level := 'superieur';
  end if;
  return new;
end;
$$;
create trigger schools_infer_level before insert on public.schools
  for each row execute function public.schools_infer_level();
revoke execute on function public.schools_infer_level() from public, anon, authenticated;

-- Établissements d'une commune : on peut se limiter à un niveau (« lycée de Nanterre » ne doit
-- pas hésiter à cause de l'université de la commune).
drop function public.schools_in_city(text, integer);
create function public.schools_in_city(p_city text, p_limit integer default 20, p_level text default null)
returns table (uai text, name text, city text, department text)
language sql stable
security invoker
set search_path = ''
as $$
  select s.uai, s.name, s.city, s.department
  from public.schools s
  where public.normalize_text(p_city) <> ''
    and extensions.similarity(s.city_norm, public.normalize_text(p_city)) >= 0.8
    and (p_level is null or s.level = p_level)
  order by extensions.similarity(s.city_norm, public.normalize_text(p_city)) desc, s.name
  limit greatest(1, least(p_limit, 50))
$$;
revoke execute on function public.schools_in_city(text, integer, text) from public, anon, authenticated;
