-- Analyse du traitement médiatique (admin seulement) : une ligne par article de presse
-- analysé. Ni texte d'article ni donnée personnelle : réponses factuelles, titre, adresse
-- et deux courts extraits (droit de citation).
create table public.media_analyses (
  id uuid primary key default gen_random_uuid(),
  url text not null unique,
  domain text not null,
  title text,
  source_id uuid references public.scrape_sources (id) on delete set null,
  published_at timestamptz,
  about_movement boolean not null,
  mentions_demands boolean not null,
  demands text[] not null default '{}',
  voices text[] not null default '{}',
  focus text not null check (focus in ('revendications', 'mobilisation', 'incidents', 'mixte')),
  incidents boolean not null,
  police_violence boolean not null,
  terms text[] not null default '{}',
  tone text not null check (tone in ('favorable', 'neutre', 'defavorable')),
  quote_demands text,
  quote_framing text,
  model text,
  analyzed_at timestamptz not null default now()
);
create index media_analyses_domain_idx on public.media_analyses (domain);
create index media_analyses_published_idx on public.media_analyses (published_at desc);

alter table public.media_analyses enable row level security;
revoke all on public.media_analyses from anon, authenticated;
grant select, delete on public.media_analyses to authenticated;
create policy "admin lit" on public.media_analyses for select to authenticated using (public.is_admin());
create policy "admin supprime" on public.media_analyses for delete to authenticated using (public.is_admin());
