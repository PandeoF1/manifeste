-- Modération : l'avis du juge (probabilité, nature) accompagne chaque signalement en attente.
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
      'photo_path', sub.photo_path,
      'judge_score', r.judge_score,
      'judge_nature', r.judge_nature,
      'judged_at', r.judged_at
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
