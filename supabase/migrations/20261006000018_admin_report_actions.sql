-- Actions du staff sur un signal existant (onglet « Signaux » de l'admin). Les droits d'écriture
-- directe restent fermés : tout passe par ces fonctions, réservées aux comptes admin.

-- Modifier : lycée, statut, heure du fait, état de modération (null = inchangé).
create or replace function public.admin_update_report(
  p_id uuid,
  p_school_uai text default null,
  p_status public.report_status default null,
  p_observed_at timestamptz default null,
  p_moderation public.moderation_status default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'réservé au staff' using errcode = '42501';
  end if;
  if p_school_uai is not null and not exists (select 1 from public.schools where uai = p_school_uai) then
    raise exception 'lycée introuvable' using errcode = 'P0002';
  end if;
  if p_observed_at is not null and p_observed_at > now() + interval '1 hour' then
    raise exception 'heure dans le futur' using errcode = '22023';
  end if;
  update public.reports
  set school_uai = coalesce(p_school_uai, school_uai),
      status = coalesce(p_status, status),
      observed_at = coalesce(p_observed_at, observed_at),
      moderation = coalesce(p_moderation, moderation)
  where id = p_id;
  if not found then
    raise exception 'signal introuvable' using errcode = 'P0002';
  end if;
end;
$$;

-- Supprimer définitivement (les données privées liées partent en cascade).
-- La photo publiée éventuelle est retirée du stockage par l'admin (API Storage).
create or replace function public.admin_delete_report(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'réservé au staff' using errcode = '42501';
  end if;
  delete from public.reports where id = p_id;
  if not found then
    raise exception 'signal introuvable' using errcode = 'P0002';
  end if;
end;
$$;

-- Renvoyer à l'IA : le signal redevient une extraction « non rattachée », avec un nom et une
-- commune vides de sens, pour que la réanalyse reparte de l'article lui-même.
-- Impossible pour un signalement sur place sans lien (rien à relire).
create or replace function public.admin_report_to_unmatched(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.reports;
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'réservé au staff' using errcode = '42501';
  end if;
  select * into r from public.reports where id = p_id;
  if not found then
    raise exception 'signal introuvable' using errcode = 'P0002';
  end if;
  if r.source_url is null then
    raise exception 'aucun article à relire pour ce signal' using errcode = '22023';
  end if;
  insert into public.unmatched_extractions (source_id, source_domain, school_name, city, status, source_url, observed_at)
  values (r.source_id, r.source_domain, 'Lycée', null, r.status, r.source_url, r.observed_at)
  returning id into v_id;
  delete from public.reports where id = p_id;
  return v_id;
end;
$$;

revoke execute on function public.admin_update_report(uuid, text, public.report_status, timestamptz, public.moderation_status) from public, anon;
revoke execute on function public.admin_delete_report(uuid) from public, anon;
revoke execute on function public.admin_report_to_unmatched(uuid) from public, anon;
grant execute on function public.admin_update_report(uuid, text, public.report_status, timestamptz, public.moderation_status) to authenticated;
grant execute on function public.admin_delete_report(uuid) to authenticated;
grant execute on function public.admin_report_to_unmatched(uuid) to authenticated;
