-- Signalements utilisateur, recherche de lycées, limitation anti-abus.
begin;
create temp table t (name text, ok boolean);
grant all on t to anon;

-- Un signalement utilisateur (même avec lien de confiance) reste en attente du staff.
insert into public.reports (school_uai, status, source_type, source_url, source_domain, observed_at)
values ('0000001A', 'bloque', 'utilisateur', 'https://www.lemonde.fr/u', 'lemonde.fr', now());
insert into t select 'utilisateur + domaine de confiance -> pending', moderation = 'pending'
  from public.reports where source_url = 'https://www.lemonde.fr/u';

-- Sans lien : autorisé pour un utilisateur, interdit pour un collecteur.
insert into public.reports (id, school_uai, status, source_type, observed_at)
values ('00000000-0000-0000-0000-0000000000f1', '0000002B', 'bloque', 'utilisateur', now());
insert into t select 'utilisateur sans lien accepté', exists (select 1 from public.reports where id = '00000000-0000-0000-0000-0000000000f1');
do $$ begin
  insert into public.reports (school_uai, status, source_type, observed_at) values ('0000002B', 'bloque', 'collecteur', now());
  raise exception 'collecteur sans lien accepté';
exception when check_violation then null;
end $$;

-- Un report collecteur concordant ne valide pas le report utilisateur, et inversement.
insert into public.reports (school_uai, status, source_type, source_url, source_domain, observed_at)
values ('0000002B', 'bloque', 'collecteur', 'https://exemple-a.fr/c', 'exemple-a.fr', now());
insert into t select 'pas de concordance avec un utilisateur', bool_and(moderation = 'pending')
  from public.reports where school_uai = '0000002B';

-- Validé par le staff : compte comme une source dans la vue.
update public.reports set moderation = 'validated' where id = '00000000-0000-0000-0000-0000000000f1';
insert into t select 'vue : signalement validé', source_count = 1 and status = 'bloque'
  from public.school_current_status where uai = '0000002B';

-- Données privées inaccessibles au public.
insert into public.report_submissions (report_id, lat, lng, distance_m)
values ('00000000-0000-0000-0000-0000000000f1', 47.238, 6.024, 40);

-- Recherche de lycées.
insert into t select 'nearby_schools', (select uai from public.nearby_schools(47.2385, 6.0245, 1000) limit 1) = '0000002B';
insert into t select 'nearby_schools rayon', not exists (select 1 from public.nearby_schools(47.2385, 6.0245, 1000) where uai = '0000001A');
insert into t select 'search_schools nom + ville', (select uai from public.search_schools('victor hugo besan') limit 1) = '0000002B';
insert into t select 'search_schools accents', exists (select 1 from public.search_schools('jaures montreuil'));
insert into t select 'school_distance_m', public.school_distance_m('0000002B', 47.2380, 6.0240) < 5;

insert into t select 'school_detail', (select round(lat::numeric, 3) = 47.238 and city = 'Besançon' from public.school_detail('0000002B'));

-- Limitation : 5 par jour, IP jamais stockée en clair.
insert into t select 'rate limit 5 ok', bool_and(public.consume_rate_limit('203.0.113.7', 5)) from generate_series(1, 5);
insert into t select 'rate limit 6e refusé', not public.consume_rate_limit('203.0.113.7', 5);
insert into t select 'autre IP ok', public.consume_rate_limit('198.51.100.1', 5);
insert into t select 'IP absente en base', not exists (select 1 from public.rate_limits where ip_hash like '%203.0.113%');

set local role anon;
insert into t select 'anon : pas de report_submissions', not has_table_privilege('anon', 'public.report_submissions', 'select');
insert into t select 'anon : pas de rate_limits', not has_table_privilege('anon', 'public.rate_limits', 'select');
insert into t select 'anon : pas de consume_rate_limit', not has_function_privilege('anon', 'public.consume_rate_limit(text, integer)', 'execute');
insert into t select 'anon : nearby_schools ok', has_function_privilege('anon', 'public.nearby_schools(double precision, double precision, integer)', 'execute');
reset role;

select name, ok from t;
do $$ declare f text; begin
  select string_agg(name, ', ') into f from t where ok is not true;
  if f is not null then raise exception 'ÉCHEC : %', f; end if;
end $$;
rollback;
