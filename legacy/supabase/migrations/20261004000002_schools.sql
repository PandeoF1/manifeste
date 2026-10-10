create table public.schools (
  uai text primary key check (uai ~ '^[0-9]{7}[A-Z]$'),
  name text not null,
  city text not null,
  postcode text,
  department text,
  academy text,
  location extensions.geography(Point, 4326),
  kind text,
  name_norm text generated always as (public.normalize_text(name)) stored,
  city_norm text generated always as (public.normalize_text(city)) stored,
  updated_at timestamptz not null default now()
);

create index schools_location_idx on public.schools using gist (location);
create index schools_name_trgm_idx on public.schools using gin (name_norm extensions.gin_trgm_ops);
create index schools_city_trgm_idx on public.schools using gin (city_norm extensions.gin_trgm_ops);
create index schools_department_idx on public.schools (department);
