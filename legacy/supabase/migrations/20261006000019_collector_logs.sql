-- Journal des collecteurs : un passage par source (seulement s'il y a du nouveau ou une erreur),
-- et le devenir de chaque nouvel élément lu. Aucun texte n'est conservé : lien, résultat et lycée
-- extrait. Lecture réservée au staff, purge après 7 jours.
create table public.collector_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.scrape_sources (id) on delete cascade,
  ran_at timestamptz not null default now(),
  fetched integer not null default 0,
  new_items integer not null default 0,
  relevant integer not null default 0,
  events integer not null default 0,
  reports integer not null default 0,
  duplicates integer not null default 0,
  unmatched integer not null default 0,
  low_certainty integer not null default 0,
  error text
);
create index collector_runs_source_idx on public.collector_runs (source_id, ran_at desc);

create table public.collector_item_logs (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.collector_runs (id) on delete cascade,
  external_id text not null,
  url text not null,
  outcome text not null check (outcome in (
    'hors_sujet', 'aucun_fait', 'certitude_faible', 'rattache', 'doublon', 'non_rattache', 'erreur', 'reporte'
  )),
  school_name text,
  city text,
  school_uai text,
  status public.report_status,
  detail text
);
create index collector_item_logs_run_idx on public.collector_item_logs (run_id);

alter table public.collector_runs enable row level security;
alter table public.collector_item_logs enable row level security;
create policy "admin lit" on public.collector_runs for select to authenticated using (public.is_admin());
create policy "admin lit" on public.collector_item_logs for select to authenticated using (public.is_admin());
revoke all on public.collector_runs, public.collector_item_logs from anon;
revoke insert, update, delete on public.collector_runs, public.collector_item_logs from authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'purge-collector-logs',
      '41 3 * * *',
      $cron$ delete from public.collector_runs where ran_at < now() - interval '7 days'; $cron$
    );
  end if;
end
$$;
