begin;
create temp table t (name text, ok boolean);
grant all on t to anon, authenticated;

select public.record_beacon('203.0.113.7', 'carte', true, '[{"name":"LCP","value":1800},{"name":"CLS","value":0.04}]');
select public.record_beacon('203.0.113.7', 'liste', true, '[]');
select public.record_beacon('198.51.100.2', 'inconnue', true, '[{"name":"LCP","value":999999},{"name":"XSS","value":1}]');
select public.record_beacon('198.51.100.2', 'carte', false, '[{"name":"INP","value":120}]');

insert into t select 'deux visiteurs uniques', (select count(*) from public.analytics_visitors where day = current_date) = 2;
insert into t select 'IP jamais stockée en clair',
  not exists (select 1 from public.analytics_visitors where visitor like '%203.0.113%');
insert into t select 'trois pages vues', (select sum(views) from public.analytics_pageviews) = 3;
insert into t select 'page inconnue rangée dans autre',
  exists (select 1 from public.analytics_pageviews where page = 'autre');
select public.record_beacon('203.0.113.7', 'donnees', true, '[]');
insert into t select 'la page données a son propre nom',
  exists (select 1 from public.analytics_pageviews where page = 'donnees')
  and exists (select 1 from pg_constraint where conrelid = 'public.analytics_live'::regclass
              and pg_get_constraintdef(oid) like '%donnees%')
  and pg_get_functiondef('public.ping_live(uuid,text)'::regprocedure) like '%donnees%';
insert into t select 'mesures valides seulement', (select count(*) from public.analytics_vitals) = 3;

select public.ping_live('00000000-0000-0000-0000-000000000001', 'carte');
select public.ping_live('00000000-0000-0000-0000-000000000001', 'liste');
select public.ping_live('00000000-0000-0000-0000-000000000002', 'nimporte');
insert into public.analytics_live (session, page, seen_at)
values ('00000000-0000-0000-0000-000000000003', 'carte', now() - interval '20 minutes');
select public.ping_live('00000000-0000-0000-0000-000000000004', 'carte');
insert into t select 'en ligne : un onglet = une ligne, les vieux effacés',
  (select count(*) from public.analytics_live) = 3;

-- La veille devient un total, ses empreintes disparaissent.
update public.analytics_visitors set day = current_date - 1;
select public.rollup_analytics();
insert into t select 'rollup : total de la veille',
  (select visitors from public.analytics_daily where day = current_date - 1) = 2;
insert into t select 'rollup : empreintes effacées', (select count(*) from public.analytics_visitors) = 0;

set local role authenticated;
select set_config('request.jwt.claims', '{"app_metadata":{"role":"admin"}}', true);
insert into t select 'admin : tableau de bord',
  (public.admin_analytics(7)->'daily'->-2->>'visitors')::int = 2;
insert into t select 'admin : en ligne', (public.admin_analytics(7)->>'live')::int = 3
  and (public.admin_analytics(7)->'live_pages'->>'carte')::int = 1;
select set_config('request.jwt.claims', '{"app_metadata":{"role":"user"}}', true);
do $$ begin
  perform public.admin_analytics(7);
  raise exception 'non-admin accepté';
exception when insufficient_privilege then null; end $$;
insert into t select 'non-admin refusé', true;
reset role;
insert into t select 'anon ne peut pas écrire de visite',
  not has_function_privilege('anon', 'public.record_beacon(text, text, boolean, jsonb)', 'execute');
insert into t select 'anon peut signaler un onglet ouvert',
  has_function_privilege('anon', 'public.ping_live(uuid, text)', 'execute');
insert into t select 'anon ne lit pas les empreintes',
  not has_table_privilege('anon', 'public.analytics_visitors', 'select');
-- Envoi direct (PostgREST) : IP et navigateur lus dans les en-têtes de la requête.
select set_config('request.headers', '{"cf-connecting-ip":"192.0.2.9","user-agent":"Mozilla/5.0 Firefox/140"}', true);
set local role anon;
select public.track_visit('carte', true, '[{"name":"FCP","value":900}]');
reset role;
insert into t select 'track_visit : nouvelle visite',
  (select count(*) from public.analytics_visitors where day = current_date) = 1
  and exists (select 1 from public.analytics_vitals where metric = 'FCP');
select set_config('request.headers', '{"cf-connecting-ip":"192.0.2.10","user-agent":"Googlebot/2.1"}', true);
set local role anon;
select public.track_visit('carte', true, '[]');
reset role;
insert into t select 'track_visit : robots ignorés',
  (select count(*) from public.analytics_visitors where day = current_date) = 1;
insert into t select 'anon ne lit pas l IP de la requête',
  not has_function_privilege('anon', 'public.request_ip()', 'execute');
-- Courbes : pas de p75 sous 3 mesures dans le créneau (LCP : 2 mesures plus haut => null).
insert into public.analytics_vitals (at, page, metric, value)
  select date_trunc('hour', now()) - interval '2 hours' + interval '1 minute' * g, 'carte', 'API', 400
  from generate_series(1, 4) g;
set local role authenticated;
select set_config('request.jwt.claims', '{"app_metadata":{"role":"admin"}}', true);
create temp table series_out on commit drop as select public.admin_analytics_series('24h') as j;
reset role;
insert into t select 'série : p75 absent sous 3 mesures, présent au-dessus',
  exists (select 1 from series_out, jsonb_array_elements(j->'points') p where p->>'api' is not null)
  and not exists (select 1 from series_out, jsonb_array_elements(j->'points') p where p->>'lcp' is not null);
insert into t select 'toutes les vérifications présentes', (select count(*) from t) = 19;

select name, ok from t;
do $$ declare f text; begin
  select string_agg(name, ', ') into f from t where ok is not true;
  if f is not null then raise exception 'ÉCHEC : %', f; end if;
end $$;
rollback;
