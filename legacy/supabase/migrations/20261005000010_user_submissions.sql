-- Signalements publics géolocalisés, avec photo facultative, validés par le staff.

-- 1. Un report utilisateur peut ne pas avoir de lien source (photo ou simple constat sur place).
alter table public.reports alter column source_url drop not null;
alter table public.reports alter column source_domain drop not null;
alter table public.reports drop constraint if exists reports_source_domain_check;
alter table public.reports add constraint reports_source_required
  check (source_type = 'utilisateur' or (source_url is not null and source_domain is not null));
alter table public.reports add constraint reports_source_domain_format
  check (source_domain is null or (source_domain <> '' and source_domain = lower(source_domain)));
-- Chemin de la photo publiée (floutée et validée par le staff), dans le bucket public "photos".
alter table public.reports add column photo_public_path text;

-- 2. Données privées d'un signalement : jamais lisibles par le public.
create table public.report_submissions (
  report_id uuid primary key references public.reports (id) on delete cascade,
  -- Photo originale (bucket privé "submissions"), supprimée dès la modération ou après 48 h.
  photo_path text,
  -- Position arrondie à ~100 m, uniquement pour aider le staff à vérifier.
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  distance_m integer not null check (distance_m >= 0),
  created_at timestamptz not null default now()
);
alter table public.report_submissions enable row level security;
create policy "admin lit" on public.report_submissions for select to authenticated using (public.is_admin());
create policy "admin met à jour" on public.report_submissions for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
revoke all on public.report_submissions from anon;
revoke insert, delete on public.report_submissions from authenticated;

-- 3. Les signalements utilisateur passent toujours par le staff, et ne comptent pas
--    dans la concordance automatique (trop facile à manipuler).
create or replace function public.reports_auto_validate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window interval := make_interval(hours => public.setting_int('concordance_window_hours', 2));
  v_key text := public.report_source_key(new.source_id, new.source_domain);
begin
  if new.moderation <> 'pending' or new.source_type = 'utilisateur' then
    return new;
  end if;

  if new.source_id is not null and exists (
    select 1 from public.scrape_sources s where s.id = new.source_id and s.trusted
  ) then
    new.moderation := 'validated';
    return new;
  end if;

  if exists (select 1 from public.trusted_domains d where d.domain = new.source_domain) then
    new.moderation := 'validated';
    return new;
  end if;

  if exists (
    select 1
    from public.reports r
    where r.school_uai = new.school_uai
      and r.status = new.status
      and r.moderation <> 'rejected'
      and r.source_type <> 'utilisateur'
      and abs(extract(epoch from (r.observed_at - new.observed_at))) <= extract(epoch from v_window)
      and public.report_source_key(r.source_id, r.source_domain) <> v_key
  ) then
    new.moderation := 'validated';
  end if;

  return new;
end;
$$;

create or replace function public.reports_promote_concordant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window interval := make_interval(hours => public.setting_int('concordance_window_hours', 2));
begin
  if new.source_type = 'utilisateur' then
    return null;
  end if;
  update public.reports r
  set moderation = 'validated'
  where r.moderation = 'pending'
    and r.id <> new.id
    and r.source_type <> 'utilisateur'
    and r.school_uai = new.school_uai
    and r.status = new.status
    and abs(extract(epoch from (r.observed_at - new.observed_at))) <= extract(epoch from v_window)
    and public.report_source_key(r.source_id, r.source_domain)
        <> public.report_source_key(new.source_id, new.source_domain);
  return null;
end;
$$;

-- 4. Vue : un signalement utilisateur validé compte comme une source à part entière.
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

-- 5. Recherche de lycées pour le formulaire (données publiques).
create or replace function public.nearby_schools(p_lat double precision, p_lng double precision, p_radius_m integer default 2000)
returns table (uai text, name text, city text, distance_m integer)
language sql stable
security invoker
set search_path = ''
as $$
  select s.uai, s.name, s.city,
         round(extensions.st_distance(s.location, extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography))::int
  from public.schools s
  where s.location is not null
    and extensions.st_dwithin(s.location, extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography, least(greatest(p_radius_m, 100), 5000))
  order by 4
  limit 15
$$;

create or replace function public.search_schools(p_query text)
returns table (uai text, name text, city text, department text)
language sql stable
security invoker
set search_path = ''
as $$
  with q as (select public.normalize_text(p_query) as t)
  select s.uai, s.name, s.city, s.department
  from public.schools s, q
  where length(q.t) >= 2
    and (s.name_norm || ' ' || s.city_norm) like '%' || replace(q.t, ' ', '%') || '%'
  order by extensions.word_similarity(q.t, s.name_norm || ' ' || s.city_norm) desc, s.name
  limit 15
$$;

-- Distance entre un point et un lycée (utilisée par l'Edge Function, service role).
create or replace function public.school_distance_m(p_uai text, p_lat double precision, p_lng double precision)
returns integer
language sql stable
set search_path = ''
as $$
  select round(extensions.st_distance(s.location, extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography))::int
  from public.schools s
  where s.uai = p_uai and s.location is not null
$$;
revoke execute on function public.school_distance_m(text, double precision, double precision) from anon, authenticated, public;

-- 6. Limitation anti-abus sans stocker d'IP : empreinte SHA-256 salée, sel renouvelé chaque jour
--    puis détruit (les empreintes de la veille deviennent impossibles à relier à une IP).
create extension if not exists pgcrypto with schema extensions;

create table public.daily_salts (
  day date primary key,
  salt text not null
);
create table public.rate_limits (
  ip_hash text not null,
  day date not null,
  count integer not null default 0,
  primary key (ip_hash, day)
);
alter table public.daily_salts enable row level security;
alter table public.rate_limits enable row level security;
revoke all on public.daily_salts, public.rate_limits from anon, authenticated;

create or replace function public.consume_rate_limit(p_ip text, p_limit integer default 5)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_salt text;
  v_hash text;
  v_count integer;
begin
  insert into public.daily_salts (day, salt)
  values (current_date, encode(extensions.gen_random_bytes(32), 'hex'))
  on conflict (day) do nothing;
  select salt into v_salt from public.daily_salts where day = current_date;
  v_hash := encode(extensions.digest(v_salt || coalesce(p_ip, ''), 'sha256'), 'hex');

  insert into public.rate_limits (ip_hash, day, count) values (v_hash, current_date, 1)
  on conflict (ip_hash, day) do update set count = public.rate_limits.count + 1
  returning count into v_count;
  return v_count <= p_limit;
end;
$$;
revoke execute on function public.consume_rate_limit(text, integer) from anon, authenticated, public;

-- 7. Stockage des photos (ignoré hors Supabase, ex. Postgres local de test).
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
      ('submissions', 'submissions', false, 5242880, array['image/jpeg', 'image/webp']),
      ('photos', 'photos', true, 2097152, array['image/jpeg', 'image/webp'])
    on conflict (id) do nothing;

    create policy "admin lit les originaux" on storage.objects for select to authenticated
      using (bucket_id = 'submissions' and public.is_admin());
    create policy "admin supprime les originaux" on storage.objects for delete to authenticated
      using (bucket_id = 'submissions' and public.is_admin());
    create policy "admin publie les photos" on storage.objects for insert to authenticated
      with check (bucket_id = 'photos' and public.is_admin());
    create policy "admin retire les photos" on storage.objects for delete to authenticated
      using (bucket_id = 'photos' and public.is_admin());
  end if;
end
$$;

-- 8. Purges planifiées.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'purge-rate-limits',
      '5 0 * * *',
      $cron$
        delete from public.rate_limits where day < current_date;
        delete from public.daily_salts where day < current_date;
      $cron$
    );
    -- Photos originales non modérées après 48 h : supprimées via l'Edge Function (API Storage).
    perform cron.schedule(
      'purge-submissions',
      '23 * * * *',
      $cron$
        select net.http_post(
          url := (select decrypted_secret from vault.decrypted_secrets where name = 'purge_url'),
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-collect-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'collect_secret')
          ),
          body := '{}'::jsonb
        )
      $cron$
    );
  end if;
end
$$;
