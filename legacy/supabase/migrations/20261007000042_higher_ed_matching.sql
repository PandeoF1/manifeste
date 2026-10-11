-- Rattachement des facs : le niveau (lycée / supérieur) se déduit du nom cité, pour que
-- « lycée de Nanterre » ne soit pas rendu ambigu par l'université de la commune, et pour que la
-- réanalyse par l'IA reçoive les sites de fac quand le nom parle d'université.
create or replace function public.school_level_of_name(p_name text)
returns text
language sql immutable
set search_path = ''
as $$
  select case
    when public.normalize_text(p_name) ~ '\mlycees?\M' then 'lycee'
    when public.normalize_text(p_name) ~ '\m(universites?|fac|faculte|iut|ufr|campus|iep)\M'
      or public.normalize_text(p_name) like '%sciences po%' then 'superieur'
    else 'lycee'
  end
$$;

create or replace function public.retry_unmatched()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  u public.unmatched_extractions;
  best record;
  second_score real;
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
      select * into best from public.match_school(u.school_name, u.city, 2) limit 1;
      if best is not null then
        select m.score into second_score from public.match_school(u.school_name, u.city, 2) m offset 1 limit 1;
        if has_city then
          ok := best.name_score >= 0.6 and best.city_score >= 0.5 and best.score >= 0.6;
        else
          ok := best.name_score >= 0.9;
        end if;
        if ok and (second_score is null or best.score - second_score >= 0.05) then
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


create or replace function public.unmatched_candidates(p_unmatched_id uuid)
returns table (uai text, name text, city text, department text)
language sql stable
security definer
set search_path = ''
as $$
  with u as (select * from public.unmatched_extractions where id = p_unmatched_id)
  select distinct on (c.uai) c.uai, c.name, c.city, c.department
  from (
    select s.uai, s.name, s.city, s.department from u, public.schools_in_city(u.city, 20, public.school_level_of_name(u.school_name)) s
    union all
    select m.uai, m.name, m.city, sc.department
    from u, public.match_school(u.school_name, u.city, 10) m
    join public.schools sc on sc.uai = m.uai
    where m.name_score >= 0.5
  ) c
  order by c.uai
  limit 25
$$;
revoke execute on function public.unmatched_candidates(uuid) from public, anon, authenticated;
