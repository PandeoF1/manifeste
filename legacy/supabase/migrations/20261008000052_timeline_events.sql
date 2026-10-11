-- Historique de la carte : tous les signalements validés depuis une date, sous forme compacte.
--
-- Le navigateur rejoue la carte à n'importe quel instant (frise en bas de la carte) : il lui faut
-- l'historique des signalements, pas seulement l'état actuel. Pour garder la réponse légère, les
-- établissements sont envoyés une seule fois (« schools ») et chaque signalement ne porte que
-- l'identifiant, le statut, l'heure (millisecondes depuis 1970) et la clé de source (« events »,
-- du plus ancien au plus récent).
--
-- Mêmes règles que la carte publique : signalements validés et non masqués, rien d'intime
-- (ni lien, ni photo, ni position d'utilisateur). La fonction tourne avec les droits de
-- l'appelant (security invoker) : les règles d'accès de la base continuent de s'appliquer.

create or replace function public.timeline_events(p_since timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with ev as (
    select r.school_uai, r.status, r.observed_at, r.created_at,
           public.report_source_key(r.source_id, r.source_domain) as source_key
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
