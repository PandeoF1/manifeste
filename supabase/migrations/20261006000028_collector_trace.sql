-- Traces d'une collecte lancée en mode « direct » depuis l'admin (page /admin/direct) :
-- chaque requête de la collecte vers Google, Telegram, Bluesky, la presse, Gemini et la base.
-- Lecture réservée au staff, diffusée en temps réel, effacée au bout d'un jour.
-- Aucune donnée personnelle : des hôtes, des libellés de sources, des noms de lycées.
create table public.collector_trace (
  id bigint generated always as identity primary key,
  run_id uuid not null,
  t timestamptz not null default now(),
  actor text not null check (actor in ('collecteur', 'lecteurs')),
  target text not null,
  phase text not null check (phase in ('start', 'req', 'res', 'err', 'end')),
  label text not null default '',
  detail text,
  ms integer,
  n integer,
  status integer
);
create index collector_trace_run_idx on public.collector_trace (run_id, id);
create index collector_trace_t_idx on public.collector_trace (t);

alter table public.collector_trace enable row level security;
create policy "admin lit" on public.collector_trace for select to authenticated using (public.is_admin());
revoke all on public.collector_trace from anon;
revoke insert, update, delete on public.collector_trace from authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.collector_trace;
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'purge-collector-trace',
      '47 * * * *',
      $cron$ delete from public.collector_trace where t < now() - interval '1 day'; $cron$
    );
  end if;
end
$$;
