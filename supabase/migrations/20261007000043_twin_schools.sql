-- Jumeaux : un même lycée figure parfois sous deux UAI (lycée général et lycée professionnel d'un
-- même nom, au même endroit). Les deux obtenaient le même score et le rattachement refusait de
-- choisir (« Lycée Condorcet » à Montreuil, « Ferdinand-Foch » à Rodez...). On les reconnaît par
-- le nom (sans mots génériques) et la distance, et on garde la fiche au nom le moins précisé.

create or replace function public.same_site(p_a text, p_b text, p_radius_m integer default 250)
returns boolean
language sql stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.schools a, public.schools b
    where a.uai = p_a and b.uai = p_b
      and a.location is not null and b.location is not null
      and public.strip_generic_words(a.name) = public.strip_generic_words(b.name)
      and extensions.st_dwithin(a.location, b.location, p_radius_m)
  )
$$;
revoke execute on function public.same_site(text, text, integer) from public, anon, authenticated;

-- match_school renvoie aussi la position (pour reconnaître les jumeaux côté collecte).
drop function public.match_school(text, text, integer);
create function public.match_school(p_name text, p_city text default null, p_limit integer default 5)
returns table (uai text, name text, city text, name_score real, city_score real, score real,
               lat double precision, lng double precision)
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
          + 0.35 * case when v_c = '' then 0 else extensions.similarity(v_c, s.city_norm) end)::real as sc,
         extensions.st_y(s.location::extensions.geometry),
         extensions.st_x(s.location::extensions.geometry)
  from public.schools s
  where v_c = ''
     or s.city_norm operator(extensions.%) v_c
     or s.name_norm like '%' || v_n || '%'
  order by sc desc, length(s.name), s.uai
  limit greatest(1, least(p_limit, 20));
end;
$$;
revoke execute on function public.match_school(text, text, integer) from anon, authenticated, public;

-- Relance du rattachement avec la règle des jumeaux.
create or replace function public.retry_unmatched()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  u public.unmatched_extractions;
  best record;
  is_ambiguous boolean;
  has_city boolean;
  ok boolean;
  v_uai text;
  v_type public.source_type;
  v_domain text;
  matched integer := 0;
begin
  if not public.is_admin() then
    raise exception 'réservé au staff' using errcode = '42501';
  end if;

  for u in select * from public.unmatched_extractions order by created_at loop
    has_city := coalesce(trim(u.city), '') <> '';
    v_uai := null;

    if has_city and public.is_generic_school_name(u.school_name, u.city) then
      if (select count(*) from public.schools_in_city(u.city, 2, public.school_level_of_name(u.school_name))) = 1 then
        select c.uai into v_uai from public.schools_in_city(u.city, 2, public.school_level_of_name(u.school_name)) c;
      end if;
    else
      select * into best from public.match_school(u.school_name, u.city, 5) limit 1;
      if best is not null then
        -- Rival proche = homonyme probable, sauf s'il s'agit du jumeau du même lieu.
        select exists (
          select 1 from public.match_school(u.school_name, u.city, 5) m
          where m.uai <> best.uai and best.score - m.score < 0.05
            and not public.same_site(best.uai, m.uai)
        ) into is_ambiguous;
        if has_city then
          ok := best.name_score >= 0.6 and best.city_score >= 0.5 and best.score >= 0.6;
        else
          ok := best.name_score >= 0.9;
        end if;
        if ok and not is_ambiguous then
          v_uai := best.uai;
        end if;
      end if;
    end if;

    if v_uai is null then
      continue;
    end if;

    select coalesce((select s.source_type from public.scrape_sources s where s.id = u.source_id), 'collecteur')
      into v_type;
    v_domain := coalesce(u.source_domain,
      regexp_replace(lower(substring(u.source_url from '^https://([^/:?#]+)')), '^(www|m|amp|mobile)\.', ''));
    insert into public.reports (school_uai, status, source_type, source_url, source_domain, source_id, observed_at)
    values (v_uai, u.status, v_type, u.source_url, v_domain, u.source_id, u.observed_at)
    on conflict (source_url, school_uai, status) do nothing;
    delete from public.unmatched_extractions where id = u.id;
    matched := matched + 1;
  end loop;
  return matched;
end;
$$;


