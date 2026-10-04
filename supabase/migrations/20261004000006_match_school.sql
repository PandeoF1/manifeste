-- Candidats pour rattacher un nom de lycée extrait (texte libre) à un UAI.
-- Score : similarité trigramme pondérée nom (0.65) + ville (0.35).
create or replace function public.match_school(p_name text, p_city text default null, p_limit int default 5)
returns table (uai text, name text, city text, name_score real, city_score real, score real)
language sql stable
security invoker
set search_path = ''
as $$
  with q as (
    select public.normalize_text(regexp_replace(p_name, '(?i)^\s*(lyc[ée]e|lp|lgt|lpo)\s+', '')) as n,
           public.normalize_text(p_city) as c
  )
  select s.uai, s.name, s.city,
         extensions.word_similarity(q.n, s.name_norm) as name_score,
         case when q.c = '' then 0 else extensions.similarity(q.c, s.city_norm) end as city_score,
         (0.65 * extensions.word_similarity(q.n, s.name_norm)
          + 0.35 * case when q.c = '' then 0 else extensions.similarity(q.c, s.city_norm) end)::real as score
  from public.schools s, q
  where q.n <> ''
    and (q.c = '' or extensions.similarity(q.c, s.city_norm) > 0.3 or s.name_norm like '%' || q.n || '%')
  order by score desc
  limit greatest(1, least(p_limit, 20))
$$;
