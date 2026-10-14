begin;
create temp table t (name text, ok boolean);
grant all on t to anon, authenticated;

insert into public.schools (uai, name, city, department, location, level) values
  ('0751967F', 'Université Paris 1 - Panthéon Sorbonne – Paris 13e (UFR Économie) (Tolbiac)', 'Paris', '75', 'SRID=4326;POINT(2.3606 48.8264)', 'superieur'),
  ('0921204J', 'Université Paris Nanterre', 'Nanterre', '92', 'SRID=4326;POINT(2.2127 48.9054)', 'superieur');

insert into t select 'un lycée garde le niveau par défaut', (select level from public.schools where uai = '0000001A') = 'lycee';
do $$ begin
  insert into public.schools (uai, name, city, level) values ('0000099Z', 'X', 'Y', 'college');
  raise exception 'niveau invalide accepté';
exception when check_violation then null; end $$;
insert into t select 'niveau contrôlé', true;

-- Établissement ajouté à la main : le nom décide du niveau.
insert into public.schools (uai, name, city) values
  ('0000096A', 'Fac de Droit de Montpellier', 'Montpellier'),
  ('0000097B', 'Lycée de l''Université', 'Lyon'),
  ('0000098C', 'Lycée Jean Moulin', 'Lyon');
insert into t select 'nom de fac -> niveau supérieur', (select level from public.schools where uai = '0000096A') = 'superieur';
insert into t select 'nom de lycée -> lycée (même avec « université »)', (select level from public.schools where uai = '0000097B') = 'lycee';
insert into t select 'lycée ordinaire -> lycée', (select level from public.schools where uai = '0000098C') = 'lycee';

-- Mots génériques de fac : « Fac de Tolbiac » ne se réduit pas à rien, « Université » seul oui.
insert into t select 'nom de fac : Tolbiac', public.strip_generic_words('Fac de Tolbiac') = 'tolbiac';
insert into t select 'générique : Université', public.is_generic_school_name('Université', 'Nanterre');
insert into t select 'générique : université de Nanterre', public.is_generic_school_name('Université de Nanterre', 'Nanterre');
insert into t select 'pas générique : Université Paris 8', not public.is_generic_school_name('Université Paris 8', 'Saint-Denis');

-- Rattachement par le nom d'usage.
insert into t select 'Fac de Tolbiac -> site Tolbiac',
  (select uai from public.match_school('Fac de Tolbiac', 'Paris', 1)) = '0751967F';
insert into t select 'Nanterre -> Université Paris Nanterre',
  (select uai from public.match_school('Université de Nanterre', 'Nanterre', 1)) = '0921204J';

-- Une commune avec un lycée et une fac : « lycée de Nanterre » reste sans ambiguïté.
insert into public.schools (uai, name, city, department, location) values
  ('0920001A', 'Lycée Joliot-Curie', 'Nanterre', '92', 'SRID=4326;POINT(2.20 48.89)');
insert into t select 'lycée de la commune : un seul', (select count(*) from public.schools_in_city('Nanterre', 5, 'lycee')) = 1;
insert into t select 'fac de la commune : une seule', (select count(*) from public.schools_in_city('Nanterre', 5, 'superieur')) = 1;
insert into t select 'sans niveau : les deux', (select count(*) from public.schools_in_city('Nanterre', 5)) = 2;

-- Niveau déduit du nom cité.
insert into t select 'niveau : université -> supérieur', public.school_level_of_name('Université de Nantes') = 'superieur';
insert into t select 'niveau : Sciences Po -> supérieur', public.school_level_of_name('Sciences Po Strasbourg') = 'superieur';
insert into t select 'niveau : lycée -> lycée', public.school_level_of_name('Lycée de l''Université') = 'lycee';
insert into t select 'niveau : nom sans indice -> lycée', public.school_level_of_name('Joliot-Curie') = 'lycee';

-- Le statut courant et les périodes portent le niveau.
insert into public.reports (school_uai, status, source_type, source_url, source_domain, moderation, observed_at) values
  ('0751967F', 'bloque', 'collecteur', 'https://exemple.fr/fac', 'exemple.fr', 'validated', now() - interval '1 hour');
set local role anon;
insert into t select 'statut courant : niveau supérieur',
  (select level from public.school_current_status where uai = '0751967F') = 'superieur';
insert into t select 'période : niveau supérieur',
  (select level from public.school_status_since(now() - interval '2 days') where uai = '0751967F') = 'superieur';
insert into t select 'fiche : niveau', (select level from public.school_detail('0751967F')) = 'superieur';
insert into t select 'recherche : niveau', exists (
  select 1 from public.search_schools('Nanterre') where uai = '0921204J' and level = 'superieur');
insert into t select 'à proximité : niveau', exists (
  select 1 from public.nearby_schools(48.9054, 2.2127, 500) where uai = '0921204J' and level = 'superieur');
reset role;

select name, ok from t;
do $$ declare f text; begin
  select string_agg(name, ', ') into f from t where ok is not true;
  if f is not null then raise exception 'ÉCHEC : %', f; end if;
end $$;
rollback;
