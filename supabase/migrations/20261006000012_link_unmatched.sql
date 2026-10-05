-- Rattachement manuel, par le staff, d'une extraction que le matching automatique n'a pas su
-- relier à un lycée. Le signal créé est validé (c'est le staff qui a vérifié), puis l'extraction
-- est retirée de la liste « Non rattachés ».
create or replace function public.link_unmatched(p_unmatched_id uuid, p_uai text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  u public.unmatched_extractions;
  v_type public.source_type;
  v_domain text;
  v_report_id uuid;
begin
  if not public.is_admin() then
    raise exception 'réservé au staff' using errcode = '42501';
  end if;

  select * into u from public.unmatched_extractions where id = p_unmatched_id;
  if not found then
    raise exception 'extraction introuvable' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.schools where uai = p_uai) then
    raise exception 'lycée introuvable' using errcode = 'P0002';
  end if;

  select coalesce((select s.source_type from public.scrape_sources s where s.id = u.source_id), 'collecteur')
    into v_type;
  -- Domaine de la source : hôte en minuscules, sans www./m./amp.
  v_domain := regexp_replace(lower(substring(u.source_url from '^https://([^/:?#]+)')), '^(www|m|amp|mobile)\.', '');

  insert into public.reports (school_uai, status, source_type, source_url, source_domain, source_id, moderation, observed_at)
  values (p_uai, u.status, v_type, u.source_url, v_domain, u.source_id, 'validated', u.observed_at)
  on conflict (source_url, school_uai, status) do update set moderation = 'validated'
  returning id into v_report_id;

  delete from public.unmatched_extractions where id = p_unmatched_id;
  return v_report_id;
end;
$$;

revoke execute on function public.link_unmatched(uuid, text) from public, anon;
grant execute on function public.link_unmatched(uuid, text) to authenticated;
