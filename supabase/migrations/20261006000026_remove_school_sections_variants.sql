-- Variantes d'écriture des sous-unités administratives que la migration 15 laissait passer :
-- « Sectiond'enseignement », « Section Enseignement Professionnel », « S.E.P. », « S.E.G.T. ».
-- Même règle que scripts/school-filter.ts. Un lycée qui aurait des signaux est conservé.
delete from public.schools s
where public.normalize_text(s.name) ~ '^(section ?d? ?enseignement|s ?e ?p |s ?e ?g ?t |ecole secondaire)'
  and not exists (select 1 from public.reports r where r.school_uai = s.uai);
