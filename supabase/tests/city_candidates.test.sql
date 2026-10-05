begin;
create temp table t (name text, ok boolean);
grant all on t to authenticated;

-- Noms génériques.
insert into t select 'générique : lycée de Hanches', public.is_generic_school_name('Lycée de Hanches', 'Hanches');
insert into t select 'générique : Lycée', public.is_generic_school_name('Lycée', 'Briançon');
insert into t select 'générique : lycée polyvalent de Saint-Malo', public.is_generic_school_name('lycée polyvalent de Saint-Malo', 'Saint-Malo');
insert into t select 'pas générique : Lycée Galilée', not public.is_generic_school_name('Lycée Galilée', 'Guérande');
insert into t select 'pas générique : lycée agricole', not public.is_generic_school_name('lycée agricole', 'Rennes');

-- Commune à lycée unique (Rennes : 1 lycée dans les données de démo), Paris : idem mais
-- Besançon/Paris ont chacun un Victor Hugo -> on ajoute un 2e lycée à Paris pour tester le refus.
insert into public.schools (uai, name, city, department, location) values
  ('0000006F', 'Lycée Charlemagne', 'Paris', '75', 'SRID=4326;POINT(2.36 48.85)');
insert into public.unmatched_extractions (id, school_name, city, status, source_url, observed_at) values
  ('00000000-0000-0000-0000-0000000000d1', 'Lycée de Rennes', 'Rennes', 'bloque', 'https://exemple.fr/r', now()),
  ('00000000-0000-0000-0000-0000000000d2', 'Lycée', 'Paris', 'bloque', 'https://exemple.fr/p', now());

set local role authenticated;
select set_config('request.jwt.claims', '{"app_metadata":{"role":"admin"}}', true);
insert into t select 'retry : 1 rattaché', public.retry_unmatched() = 1;
reset role;
insert into t select 'commune à lycée unique rattachée', exists (select 1 from public.reports where school_uai = '0000005E' and source_url = 'https://exemple.fr/r');
insert into t select 'commune à plusieurs lycées : conservé', exists (select 1 from public.unmatched_extractions where id = '00000000-0000-0000-0000-0000000000d2');

-- Candidats pour l'IA : les 2 lycées parisiens.
insert into t select 'candidats Paris', (select count(*) from public.unmatched_candidates('00000000-0000-0000-0000-0000000000d2')) = 2;
insert into t select 'anon : pas de candidats', not has_function_privilege('anon', 'public.unmatched_candidates(uuid)', 'execute');

select name, ok from t;
do $$ declare f text; begin
  select string_agg(name, ', ') into f from t where ok is not true;
  if f is not null then raise exception 'ÉCHEC : %', f; end if;
end $$;
rollback;
