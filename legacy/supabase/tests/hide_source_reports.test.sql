begin;
create temp table t (name text, ok boolean);
grant all on t to anon, authenticated;

insert into public.scrape_sources (id, kind, identifier, label)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'rss', 'https://exemple.fr/rss-masque', 'Source test');
-- Deux signaux validés de cette source, récents.
insert into public.reports (school_uai, status, source_type, source_url, source_domain, source_id, moderation, observed_at)
select uai, 'bloque', 'presse', 'https://exemple.fr/a-' || uai, 'exemple.fr',
       'aaaaaaaa-0000-0000-0000-000000000001', 'validated', now() - interval '1 hour'
from public.schools order by uai limit 2;

set local role anon;
insert into t select 'visible avant masquage',
  (select count(*) from public.reports where source_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 2;
reset role;

update public.scrape_sources set reports_hidden = true where id = 'aaaaaaaa-0000-0000-0000-000000000001';
insert into t select 'masquage propagé, rien supprimé',
  (select count(*) filter (where hidden) from public.reports where source_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 2;

-- Un nouveau signal d'une source masquée naît masqué.
insert into public.reports (school_uai, status, source_type, source_url, source_domain, source_id, moderation, observed_at)
select uai, 'bloque', 'presse', 'https://exemple.fr/b-' || uai, 'exemple.fr',
       'aaaaaaaa-0000-0000-0000-000000000001', 'validated', now() - interval '30 minutes'
from public.schools order by uai offset 2 limit 1;
insert into t select 'nouveau signal masqué',
  (select bool_and(hidden) from public.reports where source_id = 'aaaaaaaa-0000-0000-0000-000000000001');

set local role anon;
insert into t select 'public : signaux masqués invisibles',
  (select count(*) from public.reports where source_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0;
insert into t select 'public : absents de la carte et des périodes',
  not exists (select 1 from public.school_current_status
              where uai in (select uai from public.schools order by uai limit 3))
  and not exists (select 1 from public.school_status_since(now() - interval '1 day')
                  where uai in (select uai from public.schools order by uai limit 3));
reset role;

update public.scrape_sources set reports_hidden = false where id = 'aaaaaaaa-0000-0000-0000-000000000001';
set local role anon;
insert into t select 'réaffichage : tout revient',
  (select count(*) from public.reports where source_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 3;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"app_metadata":{"role":"admin"}}', true);
insert into t select 'admin : compteurs par source',
  (select total from public.admin_source_report_counts() where source_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 3;
reset role;
insert into t select 'anon : pas de compteurs admin',
  not has_function_privilege('anon', 'public.admin_source_report_counts()', 'execute');
insert into t select 'toutes les vérifications présentes', (select count(*) from t) = 8;

select name, ok from t;
do $$ declare f text; begin
  select string_agg(name, ', ') into f from t where ok is not true;
  if f is not null then raise exception 'ÉCHEC : %', f; end if;
end $$;
rollback;
