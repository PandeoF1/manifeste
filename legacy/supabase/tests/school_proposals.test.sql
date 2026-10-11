begin;
create temp table t (name text, ok boolean);
grant all on t to anon, authenticated;
create temp table ref as
  select uai, extensions.st_y(location::extensions.geometry) lat, extensions.st_x(location::extensions.geometry) lng
  from public.schools where location is not null order by uai limit 1;
grant select on ref to authenticated;

insert into public.school_proposals (id, name, city, status, lat, lng)
select 'aaaaaaaa-0000-0000-0000-0000000000a1', 'lycee agricole des sapins', 'Nulle-Part', 'bloque', lat, lng from ref;
insert into public.school_proposals (id, name, city, status, lat, lng)
select 'aaaaaaaa-0000-0000-0000-0000000000a2', 'lycée du coin', 'Ici', 'filtrant', lat, lng from ref;
insert into public.school_proposals (id, name, city, status, lat, lng)
select 'aaaaaaaa-0000-0000-0000-0000000000a3', 'lycée maritime', 'Port', 'bloque', lat, lng from ref;

set local role authenticated;
select set_config('request.jwt.claims', '{"app_metadata":{"role":"admin"}}', true);
insert into t select 'liste avec candidats proches',
  (select jsonb_array_length(public.admin_school_proposals()) = 3)
  and (select bool_and(jsonb_array_length(x->'candidates') >= 1) from jsonb_array_elements(public.admin_school_proposals()) x);

-- Rattacher à un lycée existant.
select public.admin_resolve_school_proposal('aaaaaaaa-0000-0000-0000-0000000000a2', (select uai from ref));
-- Créer avec un identifiant 999xxxxZ, nom corrigé.
create temp table created as
  select public.admin_resolve_school_proposal('aaaaaaaa-0000-0000-0000-0000000000a1', null, 'Lycée agricole des Sapins', 'Nulle-Part') uai;
-- Créer avec un UAI réel fourni.
select public.admin_resolve_school_proposal('aaaaaaaa-0000-0000-0000-0000000000a3', null, 'Lycée maritime', 'Port', '0999999X');
reset role;

insert into t select 'rattachement : signal en attente sur le lycée existant',
  exists (select 1 from public.reports r join ref on r.school_uai = ref.uai
          where r.source_type = 'utilisateur' and r.moderation = 'pending' and r.status = 'filtrant');
insert into t select 'création : identifiant 999xxxxZ et nom corrigé',
  (select uai ~ '^999[0-9]{4}Z$' from created)
  and exists (select 1 from public.schools s join created c using (uai)
              where s.name = 'Lycée agricole des Sapins' and s.department is not null and s.location is not null);
insert into t select 'création : signal + position pour la modération',
  exists (select 1 from public.reports r join created c on r.school_uai = c.uai
          join public.report_submissions rs on rs.report_id = r.id where rs.distance_m = 0);
insert into t select 'création avec UAI réel', exists (select 1 from public.schools where uai = '0999999X');
insert into t select 'propositions traitées supprimées', (select count(*) from public.school_proposals) = 0;

set local role authenticated;
select set_config('request.jwt.claims', '{"app_metadata":{"role":"user"}}', true);
do $$ begin
  perform public.admin_school_proposals();
  raise exception 'non-admin accepté';
exception when insufficient_privilege then null; end $$;
insert into t select 'non-admin refusé', true;
reset role;
insert into t select 'anon : rien', not has_table_privilege('anon', 'public.school_proposals', 'select')
  and not has_function_privilege('anon', 'public.admin_resolve_school_proposal(uuid, text, text, text, text)', 'execute');
insert into t select 'toutes les vérifications présentes', (select count(*) from t) = 8;

select name, ok from t;
do $$ declare f text; begin
  select string_agg(name, ', ') into f from t where ok is not true;
  if f is not null then raise exception 'ÉCHEC : %', f; end if;
end $$;
rollback;
