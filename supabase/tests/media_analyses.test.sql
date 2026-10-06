begin;
create temp table t (name text, ok boolean);
grant all on t to anon, authenticated;
insert into public.media_analyses (url, domain, about_movement, mentions_demands, focus, incidents, police_violence, tone)
values ('https://exemple.fr/a', 'exemple.fr', true, false, 'incidents', true, false, 'defavorable');

set local role authenticated;
select set_config('request.jwt.claims', '{"app_metadata":{"role":"admin"}}', true);
insert into t select 'admin lit', (select count(*) from public.media_analyses) = 1;
select set_config('request.jwt.claims', '{"app_metadata":{"role":"user"}}', true);
insert into t select 'compte non admin : rien', (select count(*) from public.media_analyses) = 0;
reset role;
insert into t select 'anon : aucun droit', not has_table_privilege('anon', 'public.media_analyses', 'select');
insert into t select 'pas d''écriture côté navigateur', not has_table_privilege('authenticated', 'public.media_analyses', 'insert');
do $$ begin
  insert into public.media_analyses (url, domain, about_movement, mentions_demands, focus, incidents, police_violence, tone)
  values ('https://exemple.fr/b', 'exemple.fr', true, false, 'nimporte', true, false, 'neutre');
  raise exception 'angle invalide accepté';
exception when check_violation then null; end $$;
insert into t select 'angle contrôlé', true;
insert into t select 'toutes les vérifications présentes', (select count(*) from t) = 5;
select name, ok from t;
do $$ declare f text; begin
  select string_agg(name, ', ') into f from t where ok is not true;
  if f is not null then raise exception 'ÉCHEC : %', f; end if;
end $$;
rollback;
