-- Rôle « modérateur » (app_metadata.role = 'moderator') : il valide les signalements en attente,
-- rien d'autre. Pas de rejet, pas de suppression, aucune action sur la collecte, les sources, les
-- réglages ou les stats. Aucune politique d'écriture n'est ouverte : tout passe par les deux
-- fonctions ci-dessous, qui refusent tout autre compte.
--
-- Ce que le modérateur voit : les signalements en attente, avec la distance à l'établissement et
-- la photo originale (nécessaire pour la flouter). Jamais la position, ni les sources, ni les
-- extractions non rattachées.

create or replace function public.is_moderator()
returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'moderator', false)
$$;

-- Signalements en attente, sous la forme que lit l'écran de modération.
create or replace function public.moderator_pending_reports()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.is_admin() or public.is_moderator()) then
    raise exception 'réservé au staff' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id,
      'school_uai', r.school_uai,
      'school_name', s.name,
      'school_city', s.city,
      'status', r.status,
      'observed_at', r.observed_at,
      'source_type', r.source_type,
      'source_domain', r.source_domain,
      'source_url', r.source_url,
      'source_label', ss.label,
      'certainty', r.certainty,
      'distance_m', sub.distance_m,
      'photo_path', sub.photo_path
    ) order by r.observed_at desc)
    from (
      select * from public.reports
      where moderation = 'pending'
      order by observed_at desc
      limit 200
    ) r
    left join public.schools s on s.uai = r.school_uai
    left join public.scrape_sources ss on ss.id = r.source_id
    left join public.report_submissions sub on sub.report_id = r.id
  ), '[]'::jsonb);
end;
$$;

-- Valide un signalement encore en attente. `p_photo_public_path` : photo floutée déjà publiée
-- (nom imposé : <id du signalement>.jpg), ou null.
create or replace function public.moderator_approve_report(
  p_id uuid,
  p_photo_public_path text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (public.is_admin() or public.is_moderator()) then
    raise exception 'réservé au staff' using errcode = '42501';
  end if;
  if p_photo_public_path is not null and p_photo_public_path <> p_id::text || '.jpg' then
    raise exception 'nom de photo invalide' using errcode = '22023';
  end if;
  update public.reports
  set moderation = 'validated', photo_public_path = p_photo_public_path
  where id = p_id and moderation = 'pending';
  if not found then
    raise exception 'signalement introuvable ou déjà traité' using errcode = 'P0002';
  end if;
end;
$$;

-- Le nom d'un fichier de la photo floutée correspond-il à un signalement en attente ?
-- (utilisée par la règle de stockage : le modérateur ne publie rien d'autre.)
create or replace function public.is_pending_report_photo(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.reports r
    where r.moderation = 'pending' and r.id::text || '.jpg' = p_name
  )
$$;

revoke execute on function public.is_moderator() from public, anon;
revoke execute on function public.moderator_pending_reports() from public, anon;
revoke execute on function public.moderator_approve_report(uuid, text) from public, anon;
revoke execute on function public.is_pending_report_photo(text) from public, anon;
grant execute on function public.is_moderator() to authenticated;
grant execute on function public.moderator_pending_reports() to authenticated;
grant execute on function public.moderator_approve_report(uuid, text) to authenticated;
grant execute on function public.is_pending_report_photo(text) to authenticated;

-- Stockage (ignoré hors Supabase, ex. Postgres local de test) : lecture des photos originales,
-- et dépôt de la photo floutée d'un signalement en attente. Aucune suppression : les originaux
-- sont retirés par la purge horaire (Edge Function purge-submissions) une fois le signal traité.
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    create policy "modérateur lit les originaux" on storage.objects for select to authenticated
      using (bucket_id = 'submissions' and public.is_moderator());
    create policy "modérateur publie une photo floutée" on storage.objects for insert to authenticated
      with check (
        bucket_id = 'photos' and public.is_moderator() and public.is_pending_report_photo(name)
      );
  end if;
end
$$;
