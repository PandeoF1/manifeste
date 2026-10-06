-- Lycée absent de la liste : le visiteur propose un nom et une ville avec son signalement.
-- La proposition attend l'équipe (onglet admin « Lycées proposés ») qui la rattache à un lycée
-- existant ou crée le lycée ; le signal part alors en modération comme les autres.
-- Position arrondie (~100 m) gardée seulement le temps de la décision (7 jours au plus).

create table public.school_proposals (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 3 and 120),
  city text not null check (char_length(city) between 1 and 80),
  status public.report_status not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  photo_path text,
  source_url text,
  created_at timestamptz not null default now()
);
alter table public.school_proposals enable row level security;
revoke all on public.school_proposals from anon, authenticated;
grant select, delete on public.school_proposals to authenticated;
create policy "admin lit" on public.school_proposals for select to authenticated using (public.is_admin());
create policy "admin supprime" on public.school_proposals for delete to authenticated using (public.is_admin());

-- Identifiants des lycées ajoutés à la main sans UAI connu : 999xxxxZ (aucun département 999).
create sequence public.custom_school_seq;

/** Propositions en attente, avec les lycées existants qui pourraient correspondre. */
create or replace function public.admin_school_proposals()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'city', p.city, 'status', p.status,
      'lat', p.lat, 'lng', p.lng, 'photo_path', p.photo_path, 'source_url', p.source_url,
      'created_at', p.created_at,
      'candidates', coalesce((
        select jsonb_agg(c order by c.distance_m nulls last) from (
          select distinct on (x.uai) x.uai, x.name, x.city, x.distance_m
          from (
            select m.uai, m.name, m.city,
              round(extensions.st_distance(s.location,
                extensions.st_setsrid(extensions.st_makepoint(p.lng, p.lat), 4326)::extensions.geography))::int as distance_m
            from public.match_school(p.name, p.city, 3) m
            join public.schools s on s.uai = m.uai
            union all
            select n.uai, n.name, n.city, n.distance_m
            from public.nearby_schools(p.lat, p.lng, 3000) n
          ) x
          order by x.uai
          limit 6
        ) c
      ), '[]'::jsonb)
    ) order by p.created_at desc)
    from public.school_proposals p
  ), '[]'::jsonb);
end;
$$;
revoke execute on function public.admin_school_proposals() from public, anon;
grant execute on function public.admin_school_proposals() to authenticated;

/**
 * Décision sur une proposition : rattacher à `p_link_uai`, ou créer le lycée (nom et ville
 * corrigés, UAI réel `p_new_uai` si connu, sinon 999xxxxZ ; département et académie du lycée
 * le plus proche). Crée le signal en attente de modération et supprime la proposition.
 * Renvoie l'UAI du lycée.
 */
create or replace function public.admin_resolve_school_proposal(
  p_id uuid,
  p_link_uai text default null,
  p_name text default null,
  p_city text default null,
  p_new_uai text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.school_proposals;
  v_uai text;
  v_point extensions.geography;
  v_report uuid := gen_random_uuid();
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  select * into p from public.school_proposals where id = p_id for update;
  if not found then
    raise exception 'proposition introuvable' using errcode = 'P0002';
  end if;
  v_point := extensions.st_setsrid(extensions.st_makepoint(p.lng, p.lat), 4326)::extensions.geography;

  if p_link_uai is not null then
    if not exists (select 1 from public.schools where uai = p_link_uai) then
      raise exception 'lycée introuvable' using errcode = 'P0002';
    end if;
    v_uai := p_link_uai;
  else
    if p_new_uai is not null then
      if p_new_uai !~ '^[0-9]{7}[A-Z]$' then
        raise exception 'UAI invalide (7 chiffres et une lettre)' using errcode = '22023';
      end if;
      if exists (select 1 from public.schools where uai = p_new_uai) then
        raise exception 'cet UAI existe déjà : rattache plutôt' using errcode = '23505';
      end if;
      v_uai := p_new_uai;
    else
      v_uai := '999' || lpad(nextval('public.custom_school_seq')::text, 4, '0') || 'Z';
    end if;
    insert into public.schools (uai, name, city, department, academy, location, kind)
    select v_uai,
           left(trim(coalesce(nullif(p_name, ''), p.name)), 120),
           left(trim(coalesce(nullif(p_city, ''), p.city)), 80),
           near.department, near.academy, v_point, 'ajouté'
    from (select 1) one
    left join lateral (
      select s.department, s.academy from public.schools s
      where s.location is not null
      order by s.location operator(extensions.<->) v_point
      limit 1
    ) near on true;
  end if;

  insert into public.reports (id, school_uai, status, source_type, source_url, source_domain, moderation, observed_at)
  values (
    v_report, v_uai, p.status, 'utilisateur', p.source_url,
    regexp_replace(lower(substring(p.source_url from '^https://([^/:?#]+)')), '^(www|m|amp|mobile)\.', ''),
    'pending', p.created_at
  );
  insert into public.report_submissions (report_id, photo_path, lat, lng, distance_m)
  values (
    v_report, p.photo_path, p.lat, p.lng,
    coalesce((select round(extensions.st_distance(s.location, v_point))::int
              from public.schools s where s.uai = v_uai), 0)
  );
  delete from public.school_proposals where id = p_id;
  return v_uai;
end;
$$;
revoke execute on function public.admin_resolve_school_proposal(uuid, text, text, text, text) from public, anon;
grant execute on function public.admin_resolve_school_proposal(uuid, text, text, text, text) to authenticated;
