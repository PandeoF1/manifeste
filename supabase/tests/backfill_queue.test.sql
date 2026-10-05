begin;
create temp table t (name text, ok boolean);
grant all on t to anon, authenticated;

insert into t select 'source de rattrapage créée et désactivée', exists (
  select 1 from public.scrape_sources
  where kind = 'rss' and identifier = 'https://news.google.com/rss/search?q=manifeste-rattrapage' and not enabled);

insert into public.backfill_queue (external_id, url, title, published_at, query)
values ('CBMi1', 'https://news.google.com/rss/articles/CBMi1', 'Blocus', '2026-09-30T07:00:00Z', 'lycée bloqué');
insert into public.backfill_queue (external_id, url, title, published_at, query)
values ('CBMi1', 'https://news.google.com/rss/articles/CBMi1', 'Blocus', '2026-09-30T07:00:00Z', 'autre')
on conflict (external_id) do nothing;
insert into t select 'un article n''entre qu''une fois', (select count(*) from public.backfill_queue) = 1;

do $$ begin
  insert into public.backfill_queue (external_id, url, published_at, query) values ('x', 'http://a.fr', now(), 'q');
  raise exception 'url http acceptée';
exception when check_violation then null; end $$;
insert into t select 'url https exigée', true;

set local role authenticated;
select set_config('request.jwt.claims', '{"app_metadata":{"role":"admin"}}', true);
insert into t select 'admin lit la file', (select count(*) from public.backfill_queue) = 1;
select set_config('request.jwt.claims', '{"app_metadata":{"role":"user"}}', true);
insert into t select 'non-admin ne voit rien', (select count(*) from public.backfill_queue) = 0;
reset role;
insert into t select 'anon sans droit', not has_table_privilege('anon', 'public.backfill_queue', 'select');
insert into t select 'authenticated ne peut pas écrire', not has_table_privilege('authenticated', 'public.backfill_queue', 'insert');

select name, ok from t;
do $$ declare f text; begin
  select string_agg(name, ', ') into f from t where ok is not true;
  if f is not null then raise exception 'ÉCHEC : %', f; end if;
end $$;
rollback;
