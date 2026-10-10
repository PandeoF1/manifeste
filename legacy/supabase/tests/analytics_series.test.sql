begin;
-- Les statistiques comptent en jours de Paris alors que la base tourne en UTC : sans ceci, le test
-- échoue entre 22 h et 24 h UTC (la date UTC et la date de Paris diffèrent).
set local timezone to 'Europe/Paris';
create temp table t (name text, ok boolean);
grant all on t to anon, authenticated;

select public.record_beacon('203.0.113.1', 'carte', true, '[{"name":"LCP","value":1500},{"name":"API","value":200}]');
select public.record_beacon('203.0.113.2', 'liste', true, '[]');
select public.record_beacon('203.0.113.2', 'carte', true, '[]');
select public.ping_live('00000000-0000-0000-0000-0000000000aa', 'carte');
select public.snapshot_online();
insert into public.analytics_daily (day, visitors) values (current_date - 3, 42);

insert into t select 'pages vues par tranches de 5 min',
  (select bool_and(extract(minute from hour)::int % 5 = 0 and extract(second from hour) = 0)
   from public.analytics_pageviews);
insert into t select 'relevé en ligne', (select online from public.analytics_online) = 1;
insert into t select 'compteur des nouveaux visiteurs (sans empreinte)',
  (select sum(n) from public.analytics_new_visitors) = 2;
insert into public.analytics_new_visitors (slot, n)
  values (date_bin('5 minutes', now() - interval '3 hours', timestamptz '2000-01-01'), 7);
insert into t select 'première visite datée', (select bool_and(first_seen is not null) from public.analytics_visitors);

set local role authenticated;
select set_config('request.jwt.claims', '{"app_metadata":{"role":"admin"}}', true);
create temp table s2 as select public.admin_analytics_series('2h') j;
create temp table s30 as select public.admin_analytics_series('30d') j;
insert into t select '2 h : tranches de 5 min', (select (j->>'step_seconds')::int = 300 from s2)
  and (select jsonb_array_length(j->'points') between 24 and 25 from s2);
insert into t select '2 h : 3 pages vues, 2 nouveaux visiteurs',
  (select sum((p->>'views')::int) = 3 and sum((p->>'visitors')::int) = 2
   from s2, jsonb_array_elements(j->'points') p);
insert into t select '2 h : pic en ligne et LCP', (select (j->'summary'->>'peak_online')::int = 1
  and (j->'summary'->>'lcp_p75')::int = 1500 from s2);
insert into t select '30 j : jours, archive comprise',
  (select (j->>'step_seconds')::int = 86400 and jsonb_array_length(j->'points') = 30 from s30)
  and (select bool_or((p->>'visitors')::int = 42) from s30, jsonb_array_elements(j->'points') p);
insert into t select '30 j : aujourd''hui compté',
  (select (j->'points'->-1->>'visitors')::int = 2 from s30);
create temp table s24 as select public.admin_analytics_series('24h') j;
insert into t select '24 h : nouveaux visiteurs d''une tranche passée gardés',
  (select sum((p->>'visitors')::int) = 9 from s24, jsonb_array_elements(j->'points') p);
insert into t select '24 h : avant le premier relevé, pas de valeur inventée',
  (select (j->'points'->0->'visitors') = 'null'::jsonb from s24);
select set_config('request.jwt.claims', '{"app_metadata":{"role":"user"}}', true);
do $$ begin
  perform public.admin_analytics_series('24h');
  raise exception 'non-admin accepté';
exception when insufficient_privilege then null; end $$;
insert into t select 'non-admin refusé', true;
reset role;
insert into t select 'anon : pas de relevé', not has_function_privilege('anon', 'public.snapshot_online()', 'execute');
insert into t select 'toutes les vérifications présentes', (select count(*) from t) = 13;

select name, ok from t;
do $$ declare f text; begin
  select string_agg(name, ', ') into f from t where ok is not true;
  if f is not null then raise exception 'ÉCHEC : %', f; end if;
end $$;
rollback;
