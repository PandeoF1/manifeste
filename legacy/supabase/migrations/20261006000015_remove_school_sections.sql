-- Retire du référentiel les sous-unités administratives (« Section d'enseignement
-- professionnel du lycée X ») et les écoles secondaires privées : doublons d'un lycée existant
-- ou établissements qui ne sont pas des lycées (voir scripts/school-filter.ts, appliqué à l'import).
delete from public.schools
where public.normalize_text(name) ~ '^(section d enseignement|sep |segt |ecole secondaire)';
