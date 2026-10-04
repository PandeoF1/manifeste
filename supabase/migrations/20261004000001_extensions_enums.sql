-- Extensions et types de base.
create extension if not exists postgis with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

create type public.report_status as enum ('bloque', 'filtrant', 'leve');
create type public.source_type as enum ('presse', 'syndicat', 'utilisateur', 'collecteur');
create type public.moderation_status as enum ('pending', 'validated', 'rejected');
create type public.scrape_kind as enum ('telegram', 'rss', 'bluesky');

-- Paramètres applicatifs (clé / valeur), lisibles publiquement.
create table public.app_settings (
  key text primary key,
  value text not null
);
insert into public.app_settings (key, value) values
  ('status_ttl_hours', '5'),
  ('concordance_window_hours', '2');

create or replace function public.setting_int(p_key text, p_default int)
returns int
language sql stable
set search_path = ''
as $$
  select coalesce((select value::int from public.app_settings where key = p_key), p_default)
$$;

-- Normalisation pour la recherche floue (minuscules, sans accents, ponctuation aplatie).
create or replace function public.normalize_text(p text)
returns text
language sql immutable parallel safe
set search_path = ''
as $$
  select trim(regexp_replace(lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p, ''))), '[^a-z0-9]+', ' ', 'g'))
$$;

-- Rôle admin : porté par app_metadata.role dans le JWT Supabase.
create or replace function public.is_admin()
returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
$$;
