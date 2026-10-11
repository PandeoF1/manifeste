-- Durcissement après audit de sécurité.

-- 1. Fonctions de déclencheur : jamais appelables via l'API (elles ne servent qu'aux triggers).
revoke execute on function public.reports_auto_validate() from public, anon, authenticated;
revoke execute on function public.reports_promote_concordant() from public, anon, authenticated;

-- 2. Vue publique en lecture seule (elle n'est pas modifiable, mais on retire les droits).
revoke insert, update, delete, truncate, references, trigger
  on public.school_current_status from anon, authenticated;

-- 3. Signalements des visiteurs : la position (arrondie, réservée à l'équipe) n'est gardée
--    que le temps de la modération. Après 48 h, photo déjà purgée et décision prise, la
--    ligne est effacée (le signal lui-même reste dans reports, sans position).
create or replace function public.purge_old_submissions()
returns integer
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.report_submissions s
    using public.reports r
    where r.id = s.report_id
      and s.photo_path is null
      and s.created_at < now() - interval '48 hours'
      and r.moderation <> 'pending'
    returning 1
  )
  select count(*)::int from gone;
$$;
revoke execute on function public.purge_old_submissions() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('purge-old-submissions', '33 * * * *', 'select public.purge_old_submissions()');
  end if;
end
$$;
