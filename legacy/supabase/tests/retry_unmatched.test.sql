-- Relance du rattachement automatique.
begin;
create temp table t (name text, ok boolean);
grant all on t to authenticated;

insert into public.unmatched_extractions (id, school_name, city, status, source_url, observed_at) values
  ('00000000-0000-0000-0000-0000000000c1', 'Lycée Mendès-France', 'Rennes', 'bloque', 'https://www.ouest-france.fr/a', now()),
  ('00000000-0000-0000-0000-0000000000c2', 'Lycée Victor-Hugo', null, 'bloque', 'https://exemple.fr/b', now()),
  ('00000000-0000-0000-0000-0000000000c3', 'Lycée Inconnu', 'Nulle-Part', 'bloque', 'https://exemple.fr/c', now());

set local role authenticated;
select set_config('request.jwt.claims', '{"app_metadata":{"role":"admin"}}', true);
insert into t select 'un seul rattaché', public.retry_unmatched() = 1;
reset role;

insert into t select 'Mendès-France rattaché', exists (select 1 from public.reports where school_uai = '0000005E' and source_url = 'https://www.ouest-france.fr/a');
insert into t select 'domaine de confiance -> validé', (select moderation = 'validated' from public.reports where source_url = 'https://www.ouest-france.fr/a');
insert into t select 'homonyme sans ville conservé', exists (select 1 from public.unmatched_extractions where id = '00000000-0000-0000-0000-0000000000c2');
insert into t select 'inconnu conservé', exists (select 1 from public.unmatched_extractions where id = '00000000-0000-0000-0000-0000000000c3');
insert into t select 'anon sans droit', not has_function_privilege('anon', 'public.retry_unmatched()', 'execute');

select name, ok from t;
do $$ declare f text; begin
  select string_agg(name, ', ') into f from t where ok is not true;
  if f is not null then raise exception 'ÉCHEC : %', f; end if;
end $$;
rollback;
