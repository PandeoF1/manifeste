-- Niveaux de confiance du juge : sans effet réglage coupé ; filtrage, vue « mobilisation » et données
-- ouvertes quand il est allumé.
begin;
create temp table t (name text, ok boolean);
grant all on t to anon;

insert into public.schools (uai, name, city, department, academy, level, location) values
  ('0920001A', 'Lycée Confirmé', 'Lille', '59', 'Lille', 'lycee', 'SRID=4326;POINT(3.06 50.63)'),
  ('0920002B', 'Lycée Mobilisé', 'Lille', '59', 'Lille', 'lycee', 'SRID=4326;POINT(3.07 50.64)'),
  ('0920003C', 'Lycée Récit', 'Toulouse', '31', 'Toulouse', 'lycee', 'SRID=4326;POINT(1.44 43.60)'),
  ('0920004D', 'Lycée Sans Avis', 'Toulouse', '31', 'Toulouse', 'lycee', 'SRID=4326;POINT(1.45 43.61)'),
  ('0920005E', 'Lycée Levé', 'Nantes', '44', 'Nantes', 'lycee', 'SRID=4326;POINT(-1.55 47.21)');

insert into public.reports
  (school_uai, status, source_type, source_url, source_domain, moderation, observed_at, judge_score, judge_nature)
values
  ('0920001A', 'bloque', 'presse', 'https://p.example/1', 'p.example', 'validated', now() - interval '1 hour', 0.9, 'blocage'),
  ('0920002B', 'bloque', 'presse', 'https://p.example/2', 'p.example', 'validated', now() - interval '1 hour', 0.1, 'rassemblement'),
  ('0920003C', 'bloque', 'presse', 'https://p.example/3', 'p.example', 'validated', now() - interval '1 hour', 0.05, 'autre'),
  ('0920004D', 'bloque', 'presse', 'https://p.example/4', 'p.example', 'validated', now() - interval '1 hour', null, null),
  ('0920005E', 'leve',   'presse', 'https://p.example/5', 'p.example', 'validated', now() - interval '1 hour', 0.8, 'autre');
insert into public.reports (school_uai, status, source_type, moderation, observed_at)
values ('0920003C', 'filtrant', 'utilisateur', 'validated', now() - interval '2 hours');

-- Niveau de chaque signalement (réglage ignoré par report_tier lui-même).
insert into t select 'niveau : blocage sûr = confirme',
  (select public.report_tier(r) = 'confirme' from public.reports r where source_url = 'https://p.example/1');
insert into t select 'niveau : rassemblement faible = mobilise',
  (select public.report_tier(r) = 'mobilise' from public.reports r where source_url = 'https://p.example/2');
insert into t select 'niveau : récit faible = non-retenu',
  (select public.report_tier(r) = 'non-retenu' from public.reports r where source_url = 'https://p.example/3');
insert into t select 'niveau : sans avis = non-juge',
  (select public.report_tier(r) = 'non-juge' from public.reports r where source_url = 'https://p.example/4');
insert into t select 'niveau : un « levé » compte sur le score seul',
  (select public.report_tier(r) = 'confirme' from public.reports r where source_url = 'https://p.example/5');
insert into t select 'niveau : signalement sur place = confirme',
  (select public.report_tier(r) = 'confirme' from public.reports r where source_type = 'utilisateur');

set local role anon;

-- Réglage coupé (par défaut) : tout compte comme avant, aucune mobilisation.
insert into t select 'coupé : les 5 établissements sont dans le direct',
  (select count(*) = 5 from public.school_current_status);
insert into t select 'coupé : aucune vue mobilisation', (select count(*) = 0 from public.school_mobilisation_status);
insert into t select 'coupé : données ouvertes inchangées (4 établissements bloqués ou filtrants)',
  (select (public.open_data('resume')->>'etablissements')::int = 4);
insert into t select 'coupé : mobilises = 0', (select (public.open_data('resume')->>'mobilises')::int = 0);
insert into t select 'coupé : aucune confiance dans les exports',
  (select bool_and(p->>'confiance' is null) from jsonb_array_elements(public.open_data('signalements')) p);
insert into t select 'coupé : la mobilisation des périodes est vide',
  (select count(*) = 0 from public.school_mobilisation_since(now() - interval '1 day'));

-- Allumé.
reset role;
update public.app_settings set value = 'on' where key = 'judge_tiers';
set local role anon;

insert into t select 'allumé : le direct garde confirmé, sans avis, sur place et levé (4)',
  (select count(*) = 4 from public.school_current_status);
insert into t select 'allumé : le récit sans avis sur place reste (sur place compte)',
  (select count(*) = 1 from public.school_current_status where uai = '0920003C');
insert into t select 'allumé : le rassemblement sort du direct',
  (select count(*) = 0 from public.school_current_status where uai = '0920002B');
insert into t select 'allumé : il est dans la vue mobilisation',
  (select count(*) = 1 from public.school_mobilisation_status where uai = '0920002B');
insert into t select 'allumé : la vue mobilisation a les mêmes colonnes que le direct',
  (select count(*) = 1 from public.school_mobilisation_status where lat is not null and level = 'lycee');
insert into t select 'allumé : données ouvertes sans le rassemblement (3 établissements)',
  (select (public.open_data('resume')->>'etablissements')::int = 3);
insert into t select 'allumé : mobilises = 1', (select (public.open_data('resume')->>'mobilises')::int = 1);
insert into t select 'allumé : l''historique garde le rassemblement, marqué « m »',
  (select bool_or((e->>'u') = '0920002B' and (e->>'m')::boolean)
   from jsonb_array_elements(public.timeline_events(now() - interval '1 day')->'events') e);
insert into t select 'allumé : les périodes ignorent le rassemblement',
  (select count(*) = 0 from public.school_status_since(now() - interval '1 day') where uai = '0920002B');
insert into t select 'allumé : les périodes le montrent dans la mobilisation',
  (select count(*) = 1 from public.school_mobilisation_since(now() - interval '1 day') where uai = '0920002B');
insert into t select 'allumé : un établissement confirmé n''est pas dans la mobilisation des périodes',
  (select count(*) = 0 from public.school_mobilisation_since(now() - interval '1 day') where uai = '0920001A');
insert into t select 'allumé : jours : une mobilisation aujourd''hui',
  (select coalesce(sum((p->>'mobilises')::int), 0) = 1
   from jsonb_array_elements(public.open_data('jours')) p);
insert into t select 'allumé : établissements : confiance confirmé et mobilisation',
  (select bool_or(p->>'uai' = '0920001A' and p->>'confiance' = 'confirmé')
      and bool_or(p->>'uai' = '0920002B' and p->>'confiance' = 'mobilisation')
   from jsonb_array_elements(public.open_data('etablissements')) p);
insert into t select 'allumé : signalements : la mobilisation est listée avec sa confiance',
  (select count(*) = 1 from jsonb_array_elements(public.open_data('signalements')) p
   where p->>'confiance' = 'mobilisation');
insert into t select 'allumé : départements : mobilises = 1 dans le Nord',
  (select (p->>'mobilises')::int = 1
   from jsonb_array_elements(public.open_data('departements')) p where p->>'zone' = '59');

-- Seuils modifiables depuis l'admin ; réglage invalide refusé.
reset role;
update public.app_settings set value = '0.95' where key = 'judge_keep';
insert into t select 'seuil : 0,9 devient « pas clair » quand le seuil monte à 0,95',
  (select public.report_tier(r) = 'mobilise' from public.reports r where source_url = 'https://p.example/1');
update public.app_settings set value = '0.5' where key = 'judge_keep';

insert into t select 'toutes les vérifications présentes', (select count(*) from t) = 28;

select name, ok from t;
do $$ declare f text; begin
  select string_agg(name, ', ') into f from t where ok is not true;
  if f is not null then raise exception 'ÉCHEC : %', f; end if;
end $$;
rollback;
