-- Relance du rattachement automatique sur les extractions non rattachées (par exemple après
-- l'import ou la mise à jour du référentiel des lycées). Mêmes seuils que pickMatch
-- (supabase/functions/_shared/matching.ts). Les signaux créés passent par la règle de
-- validation habituelle (trigger), comme ceux de la collecte.
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
  v_type public.source_type;
  v_domain text;
  matched integer := 0;
begin
  if not public.is_admin() then
    raise exception 'réservé au staff' using errcode = '42501';
  end if;

  for u in select * from public.unmatched_extractions order by created_at loop
    has_city := coalesce(trim(u.city), '') <> '';
    select * into best from public.match_school(u.school_name, u.city, 2) limit 1;
    if best is null then
      continue;
    end if;
    select m.score into second_score from public.match_school(u.school_name, u.city, 2) m offset 1 limit 1;

    if has_city then
      ok := best.name_score >= 0.6 and best.city_score >= 0.5 and best.score >= 0.6;
    else
      ok := best.name_score >= 0.9;
    end if;
    ok := ok and (second_score is null or best.score - second_score >= 0.05);
    if not ok then
      continue;
    end if;

    select coalesce((select s.source_type from public.scrape_sources s where s.id = u.source_id), 'collecteur')
      into v_type;
    v_domain := regexp_replace(lower(substring(u.source_url from '^https://([^/:?#]+)')), '^(www|m|amp|mobile)\.', '');

    insert into public.reports (school_uai, status, source_type, source_url, source_domain, source_id, observed_at)
    values (best.uai, u.status, v_type, u.source_url, v_domain, u.source_id, u.observed_at)
    on conflict (source_url, school_uai, status) do nothing;

    delete from public.unmatched_extractions where id = u.id;
    matched := matched + 1;
  end loop;
  return matched;
end;
$$;

revoke execute on function public.retry_unmatched() from public, anon;
grant execute on function public.retry_unmatched() to authenticated;
