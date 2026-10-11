-- File d'attente du rattrapage historique (CLI `npm run backfill`).
-- `fetch` y dépose les articles Google Actualités pertinents depuis le début du mouvement,
-- `process` la vide par lots vers l'IA au rythme permis par le quota Gemini.
-- Seuls le titre (effacé une fois traité), le lien et l'éditeur sont gardés : jamais le texte.
create table public.backfill_queue (
  id bigint generated always as identity primary key,
  external_id text not null unique,
  url text not null check (url like 'https://%'),
  title text,
  publisher_domain text,
  published_at timestamptz not null,
  query text not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'error')),
  attempts integer not null default 0,
  outcome text,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index backfill_queue_pending_idx on public.backfill_queue (published_at)
  where status = 'pending';

alter table public.backfill_queue enable row level security;
create policy "admin lit" on public.backfill_queue for select to authenticated using (public.is_admin());
revoke all on public.backfill_queue from anon;
revoke insert, update, delete on public.backfill_queue from authenticated;

-- Source technique à laquelle sont rattachés les signaux du rattrapage (journal visible dans
-- l'admin). Désactivée : la collecte planifiée ne la lit jamais.
insert into public.scrape_sources (kind, identifier, label, source_type, trusted, enabled)
values (
  'rss',
  'https://news.google.com/rss/search?q=manifeste-rattrapage',
  'Rattrapage Google Actualités (CLI)',
  'presse',
  false,
  false
)
on conflict (kind, identifier) do nothing;
