-- Liste blanche de domaines (presse, syndicats).
create table public.trusted_domains (
  domain text primary key check (domain = lower(domain) and domain !~ '^www\.'),
  label text not null,
  kind public.source_type not null check (kind in ('presse', 'syndicat'))
);

-- Sources surveillées par les collecteurs automatiques.
create table public.scrape_sources (
  id uuid primary key default gen_random_uuid(),
  kind public.scrape_kind not null,
  -- telegram : nom du canal public ; rss : URL du flux ; bluesky : handle du compte.
  identifier text not null,
  label text not null,
  source_type public.source_type not null default 'collecteur'
    check (source_type <> 'utilisateur'),
  -- Une source de confiance valide ses signaux sans modération.
  trusted boolean not null default false,
  enabled boolean not null default true,
  last_run_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (kind, identifier)
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  school_uai text not null references public.schools (uai) on delete cascade,
  status public.report_status not null,
  source_type public.source_type not null,
  source_url text not null check (source_url ~ '^https://'),
  source_domain text not null check (source_domain <> '' and source_domain = lower(source_domain)),
  source_id uuid references public.scrape_sources (id) on delete set null,
  moderation public.moderation_status not null default 'pending',
  -- Indice de confiance de l'extraction automatique (null pour les autres émetteurs).
  certainty text check (certainty in ('haute', 'moyenne', 'faible')),
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  -- Un même post ne produit qu'un signal par lycée et par statut.
  unique (source_url, school_uai, status)
);

create index reports_school_observed_idx on public.reports (school_uai, observed_at desc);
create index reports_validated_observed_idx on public.reports (observed_at desc) where moderation = 'validated';
create index reports_pending_idx on public.reports (created_at) where moderation = 'pending';

-- Éléments déjà traités par les collecteurs (déduplication). Aucun contenu n'est conservé.
create table public.scraped_items (
  source_id uuid not null references public.scrape_sources (id) on delete cascade,
  external_id text not null,
  processed_at timestamptz not null default now(),
  primary key (source_id, external_id)
);

-- Extractions que le matching n'a pas pu rattacher à un UAI, pour revue.
create table public.unmatched_extractions (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.scrape_sources (id) on delete set null,
  school_name text not null,
  city text,
  status public.report_status not null,
  source_url text not null,
  observed_at timestamptz not null,
  created_at timestamptz not null default now()
);
