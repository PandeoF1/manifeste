-- Jumeaux d'un même lieu (lycée général / professionnel) et homonymes éloignés.
begin;
create temp table t (name text, ok boolean);
grant all on t to authenticated;

insert into public.schools (uai, name, city, department, location) values
  ('0990001A', 'Lycée Condorcet', 'Montreuil', '93', 'SRID=4326;POINT(2.4400 48.8600)'),
  ('0990002B', 'Lycée professionnel Condorcet', 'Montreuil', '93', 'SRID=4326;POINT(2.4402 48.8601)'),
  ('0990003C', 'Lycée Pasteur', 'Lavalville', '93', 'SRID=4326;POINT(2.1000 48.9000)'),
  ('0990004D', 'Lycée privé Pasteur', 'Lavalville', '93', 'SRID=4326;POINT(2.1200 48.9100)');

insert into t select 'jumeaux : même lieu', public.same_site('0990001A', '0990002B');
insert into t select 'homonymes éloignés : pas jumeaux', not public.same_site('0990003C', '0990004D');
insert into t select 'match_school renvoie la position', (select lat is not null and lng is not null from public.match_school('Condorcet', 'Montreuil', 1));
insert into t select 'à score égal, le nom le moins précisé d''abord', (select uai from public.match_school('Condorcet', 'Montreuil', 1)) = '0990001A';

insert into public.unmatched_extractions (id, school_name, city, status, source_url, observed_at) values
  ('00000000-0000-0000-0000-0000000000e1', 'lycée Condorcet', 'Montreuil', 'bloque', 'https://exemple.fr/e1', now()),
  ('00000000-0000-0000-0000-0000000000e2', 'lycée Pasteur', 'Lavalville', 'bloque', 'https://exemple.fr/e2', now());

set local role authenticated;
select set_config('request.jwt.claims', '{"app_metadata":{"role":"admin"}}', true);
select public.retry_unmatched();
reset role;

insert into t select 'jumeaux : rattaché au lycée du même nom', exists (select 1 from public.reports where school_uai = '0990001A' and source_url = 'https://exemple.fr/e1');
insert into t select 'homonymes éloignés : laissé à la main', exists (select 1 from public.unmatched_extractions where id = '00000000-0000-0000-0000-0000000000e2');
insert into t select 'same_site réservé au service', not has_function_privilege('anon', 'public.same_site(text, text, integer)', 'execute');

select name, ok from t;
do $$ declare f text; begin
  select string_agg(name, ', ') into f from t where ok is not true;
  if f is not null then raise exception 'ÉCHEC : %', f; end if;
end $$;
rollback;
