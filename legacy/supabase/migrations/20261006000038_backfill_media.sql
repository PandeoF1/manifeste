-- Rattrapage de l'analyse des médias sur les articles déjà en file (npm run backfill -- media).
alter table public.backfill_queue add column media_done_at timestamptz;
create index backfill_queue_media_idx on public.backfill_queue (published_at) where media_done_at is null;
