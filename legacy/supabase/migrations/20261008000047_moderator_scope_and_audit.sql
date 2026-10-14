-- Rôle modérateur, suite : lecture des stats et des médias, traitement des établissements
-- proposés (rattacher ou ajouter, pas de rejet), et journal de tout ce qu'un modérateur fait,
-- pour pouvoir revenir en arrière.

-- 1. Journal. Rempli uniquement par les fonctions ci-dessous (security definer) ; personne ne peut
--    le modifier ou l'effacer par l'API, et seul un admin le lit. Il ne garde jamais de position
--    ni de photo de visiteur : seulement de quoi retrouver et défaire l'action.
create table public.moderation_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid default ((auth.jwt() ->> 'sub')::uuid),
  actor_email text default (auth.jwt() ->> 'email'),
  action text not null,
  target text,
  before jsonb,
  after jsonb
);
create index moderation_audit_at_idx on public.moderation_audit (at desc);
alter table public.moderation_audit enable row level security;
revoke all on public.moderation_audit from public, anon, authenticated;
grant select on public.moderation_audit to authenticated;
create policy "admin lit le journal" on public.moderation_audit for select to authenticated
  using (public.is_admin());

create or replace function public.log_moderation_action(
  p_action text, p_target text, p_before jsonb, p_after jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.moderation_audit (action, target, before, after)
  values (p_action, p_target, p_before, p_after)
$$;
revoke execute on function public.log_moderation_action(text, text, jsonb, jsonb) from public, anon, authenticated;

-- 2. Validation d'un signalement : journalisée.
create or replace function public.moderator_approve_report(
  p_id uuid,
  p_photo_public_path text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.reports;
begin
  if not (public.is_admin() or public.is_moderator()) then
    raise exception 'réservé au staff' using errcode = '42501';
  end if;
  if p_photo_public_path is not null and p_photo_public_path <> p_id::text || '.jpg' then
    raise exception 'nom de photo invalide' using errcode = '22023';
  end if;
  update public.reports
  set moderation = 'validated', photo_public_path = p_photo_public_path
  where id = p_id and moderation = 'pending'
  returning * into r;
  if not found then
    raise exception 'signalement introuvable ou déjà traité' using errcode = 'P0002';
  end if;
  if public.is_moderator() then
    perform public.log_moderation_action(
      'valider_signalement', r.id::text,
      jsonb_build_object('moderation', 'pending', 'photo_public_path', null),
      jsonb_build_object('moderation', 'validated', 'photo_public_path', r.photo_public_path,
                         'school_uai', r.school_uai, 'status', r.status, 'source_url', r.source_url)
    );
  end if;
end;
$$;

-- 3. Stats (lecture) et liste des propositions : ouvertes au modérateur, la garde est la seule
--    ligne qui change dans ces fonctions.
do $$
declare
  r record;
  def text;
begin
  for r in
    select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('admin_analytics', 'admin_analytics_series', 'admin_school_proposals')
  loop
    def := pg_get_functiondef(r.oid);
    if position('if not public.is_admin() then' in def) = 0 then
      raise exception 'garde introuvable dans %', r.proname;
    end if;
    execute replace(def, 'if not public.is_admin() then',
                    'if not (public.is_admin() or public.is_moderator()) then');
  end loop;
end
$$;

-- 4. Médias : lecture seule (la suppression reste réservée à l'admin).
create policy "modérateur lit" on public.media_analyses for select to authenticated
  using (public.is_moderator());

-- 5. Établissement proposé : rattacher à un lycée existant, ou l'ajouter. Le signal part en
--    modération (un modérateur le valide ensuite). Le rejet reste réservé à l'admin.
--    Le journal garde la proposition sans sa position ni sa photo.
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
  v_created boolean := false;
begin
  if not (public.is_admin() or public.is_moderator()) then
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
    v_created := true;
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

  if public.is_moderator() then
    perform public.log_moderation_action(
      case when v_created then 'ajouter_etablissement' else 'rattacher_proposition' end,
      p_id::text,
      jsonb_build_object('name', p.name, 'city', p.city, 'status', p.status,
                         'source_url', p.source_url, 'created_at', p.created_at),
      jsonb_build_object('school_uai', v_uai, 'school_created', v_created, 'report_id', v_report)
    );
  end if;
  return v_uai;
end;
$$;
