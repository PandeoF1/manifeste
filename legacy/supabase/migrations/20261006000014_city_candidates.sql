-- Domaine de l'éditeur réel (Google Actualités : le lien pointe vers news.google.com).
alter table public.unmatched_extractions add column if not exists source_domain text;

-- Lycées d'une commune : rattachement des noms génériques (« lycée de Hanches ») quand la
-- commune n'a qu'un lycée, et candidats proposés à l'IA lors d'une réanalyse.
create or replace function public.schools_in_city(p_city text, p_limit integer default 20)
returns table (uai text, name text, city text, department text)
language sql stable
security invoker
set search_path = ''
as $$
  select s.uai, s.name, s.city, s.department
  from public.schools s
  where public.normalize_text(p_city) <> ''
    and extensions.similarity(s.city_norm, public.normalize_text(p_city)) >= 0.8
  order by extensions.similarity(s.city_norm, public.normalize_text(p_city)) desc, s.name
  limit greatest(1, least(p_limit, 50))
$$;
revoke execute on function public.schools_in_city(text, integer) from public, anon, authenticated;

-- Nom sans les mots génériques (lycée, polyvalent, de, la...).
create or replace function public.strip_generic_words(p text)
returns text
language sql immutable
set search_path = ''
as $$
  select trim(regexp_replace(
    regexp_replace(
      public.normalize_text(p),
      '\m(lycee|lycees|lp|lgt|lpo|general|generale|polyvalent|professionnel|technologique|public|prive|des|du|de|la|le|les|l|d|et|a)\M',
      ' ', 'g'),
    '\s+', ' ', 'g'))
$$;

-- Nom générique : rien d'autre que « lycée (polyvalent...) (de <commune>) ».
create or replace function public.is_generic_school_name(p_name text, p_city text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select public.strip_generic_words(p_name) in ('', public.strip_generic_words(coalesce(p_city, '')))
$$;

-- Matching : on compare le nom débarrassé des mots génériques (« Lycée », « Lycée professionnel
-- Robert-Buron » -> « robert buron »). Un nom vide (purement générique) ne renvoie rien.
create or replace function public.match_school(p_name text, p_city text default null, p_limit int default 5)
returns table (uai text, name text, city text, name_score real, city_score real, score real)
language sql stable
security invoker
set search_path = ''
as $$
  with q as (
    select public.strip_generic_words(p_name) as n,
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
revoke execute on function public.match_school(text, text, int) from anon, authenticated, public;

-- Relance du rattachement : ajoute la règle « commune à lycée unique » pour les noms génériques.
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
      if (select count(*) from public.schools_in_city(u.city, 2)) = 1 then
        select c.uai into v_uai from public.schools_in_city(u.city, 2) c;
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

-- Candidats pour la réanalyse par l'IA : lycées de la commune + lycées au nom proche.
create or replace function public.unmatched_candidates(p_unmatched_id uuid)
returns table (uai text, name text, city text, department text)
language sql stable
security definer
set search_path = ''
as $$
  with u as (select * from public.unmatched_extractions where id = p_unmatched_id)
  select distinct on (c.uai) c.uai, c.name, c.city, c.department
  from (
    select s.uai, s.name, s.city, s.department from u, public.schools_in_city(u.city, 20) s
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

-- Rattachement manuel : utilise aussi le domaine de l'éditeur réel.
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
  v_domain := coalesce(u.source_domain,
    regexp_replace(lower(substring(u.source_url from '^https://([^/:?#]+)')), '^(www|m|amp|mobile)\.', ''));
  insert into public.reports (school_uai, status, source_type, source_url, source_domain, source_id, moderation, observed_at)
  values (p_uai, u.status, v_type, u.source_url, v_domain, u.source_id, 'validated', u.observed_at)
  on conflict (source_url, school_uai, status) do update set moderation = 'validated'
  returning id into v_report_id;
  delete from public.unmatched_extractions where id = p_unmatched_id;
  return v_report_id;
end;
$$;
