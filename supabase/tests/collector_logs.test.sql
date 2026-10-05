begin;
create temp table t (name text, ok boolean);
grant all on t to anon, authenticated;
insert into public.scrape_sources (id, kind, identifier, label) values ('00000000-0000-0000-0000-0000000000c9', 'telegram', 'canal_log', 'Canal');
insert into public.collector_runs (id, source_id, new_items) values ('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-0000000000c9', 1);
insert into public.collector_item_logs (run_id, external_id, url, outcome) values ('00000000-0000-0000-0000-0000000000ca', 'canal_log/1', 'https://t.me/canal_log/1', 'hors_sujet');

set local role authenticated;
select set_config('request.jwt.claims', '{"app_metadata":{"role":"admin"}}', true);
insert into t select 'admin lit le journal', (select count(*) from public.collector_item_logs) = 1;
select set_config('request.jwt.claims', '{"app_metadata":{"role":"user"}}', true);
insert into t select 'non-admin ne voit rien', (select count(*) from public.collector_runs) = 0;
reset role;
insert into t select 'anon sans droit', not has_table_privilege('anon', 'public.collector_item_logs', 'select');

delete from public.scrape_sources where id = '00000000-0000-0000-0000-0000000000c9';
insert into t select 'suppression en cascade', not exists (select 1 from public.collector_item_logs where external_id = 'canal_log/1');

select name, ok from t;
do $$ declare f text; begin
  select string_agg(name, ', ') into f from t where ok is not true;
  if f is not null then raise exception 'ÉCHEC : %', f; end if;
end $$;
rollback;
