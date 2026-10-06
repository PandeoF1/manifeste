begin;
create temp table t (name text, ok boolean);
grant all on t to anon, authenticated;
insert into public.collector_trace (run_id, actor, target, phase, label)
values ('11111111-2222-3333-4444-555555555555', 'lecteurs', 'rss', 'req', 'ladepeche.fr/rss.xml');

set local role authenticated;
select set_config('request.jwt.claims', '{"app_metadata":{"role":"admin"}}', true);
insert into t select 'admin lit les traces', (select count(*) from public.collector_trace) = 1;
select set_config('request.jwt.claims', '{"app_metadata":{"role":"user"}}', true);
insert into t select 'non-admin ne voit rien', (select count(*) from public.collector_trace) = 0;
reset role;
insert into t select 'anon sans droit', not has_table_privilege('anon', 'public.collector_trace', 'select');
insert into t select 'authenticated ne peut pas écrire', not has_table_privilege('authenticated', 'public.collector_trace', 'insert');
do $$ begin
  insert into public.collector_trace (run_id, actor, target, phase) values (gen_random_uuid(), 'x', 'rss', 'req');
  raise exception 'acteur invalide accepté';
exception when check_violation then null; end $$;
insert into t select 'acteur contrôlé', true;
insert into t select 'toutes les vérifications présentes', (select count(*) from t) = 5;

select name, ok from t;
do $$ declare f text; begin
  select string_agg(name, ', ') into f from t where ok is not true;
  if f is not null then raise exception 'ÉCHEC : %', f; end if;
end $$;
rollback;
