-- match_school : même résultat, mais les candidats viennent des index trigrammes (ville
-- proche via l'opérateur %, ou nom contenant la requête) au lieu d'un calcul de similarité
-- sur les ~4 750 lycées à chaque appel (~320 ms -> ~30 ms par rattachement).
create or replace function public.match_school(p_name text, p_city text default null, p_limit integer default 5)
returns table (uai text, name text, city text, name_score real, city_score real, score real)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_n text := public.strip_generic_words(p_name);
  v_c text := public.normalize_text(p_city);
begin
  if v_n = '' then
    return;
  end if;
  return query
  select s.uai, s.name, s.city,
         extensions.word_similarity(v_n, s.name_norm),
         case when v_c = '' then 0::real else extensions.similarity(v_c, s.city_norm) end,
         (0.65 * extensions.word_similarity(v_n, s.name_norm)
          + 0.35 * case when v_c = '' then 0 else extensions.similarity(v_c, s.city_norm) end)::real as sc
  from public.schools s
  where v_c = ''
     or s.city_norm operator(extensions.%) v_c
     or s.name_norm like '%' || v_n || '%'
  order by sc desc
  limit greatest(1, least(p_limit, 20));
end;
$$;
