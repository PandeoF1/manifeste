-- Historique de la carte : un signalement sur place compte pour une source à lui seul.
--
-- Même règle que la vue du direct (school_current_status) : sans source ni domaine, la clé de
-- source est « usr: » + l'identifiant du signalement. Avant, elle était vide et le nombre de
-- sources d'un lycée signalé seulement sur place valait 0 dans l'historique, 1 en direct.
-- (La migration précédente est déjà appliquée : on remplace la fonction, signature inchangée.)

create or replace function public.timeline_events(p_since timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with ev as (
    select r.school_uai, r.status, r.observed_at, r.created_at,
           coalesce(public.report_source_key(r.source_id, r.source_domain), 'usr:' || r.id::text) as source_key
    from public.reports r
    where r.moderation = 'validated'
      and not r.hidden
      and r.observed_at > greatest(p_since, now() - interval '366 days')
      and r.observed_at <= now() + interval '10 minutes'
  )
  select jsonb_build_object(
    'schools', coalesce((
      select jsonb_agg(jsonb_build_object(
        'uai', s.uai, 'name', s.name, 'city', s.city,
        'department', s.department, 'academy', s.academy,
        'lat', extensions.st_y(s.location::extensions.geometry),
        'lng', extensions.st_x(s.location::extensions.geometry),
        'level', s.level
      ) order by s.uai)
      from public.schools s
      where s.uai in (select school_uai from ev)
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'u', e.school_uai,
        's', e.status,
        't', (extract(epoch from e.observed_at) * 1000)::bigint,
        'k', e.source_key
      ) order by e.observed_at, e.created_at)
      from ev e
    ), '[]'::jsonb)
  )
$$;
grant execute on function public.timeline_events(timestamptz) to anon, authenticated;
