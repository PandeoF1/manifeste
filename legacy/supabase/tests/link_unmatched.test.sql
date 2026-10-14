-- Rattachement manuel des extractions non rattachées.
begin;
create temp table t (name text, ok boolean);
grant all on t to anon, authenticated;

insert into public.scrape_sources (id, kind, identifier, label, source_type)
values ('00000000-0000-0000-0000-0000000000a1', 'rss', 'https://exemple.fr/feed', 'Flux', 'presse');
insert into public.unmatched_extractions (id, source_id, school_name, city, status, source_url, observed_at)
values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'Lycée', 'Besançon', 'filtrant',
        'https://www.Exemple-Journal.fr/article', now() - interval '20 minutes');

-- Un visiteur ou un compte non admin ne peut pas rattacher.
do $$ begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"app_metadata":{"role":"user"}}', true);
  begin
    perform public.link_unmatched('00000000-0000-0000-0000-0000000000b1', '0000002B');
    raise exception 'non-admin a pu rattacher';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
insert into t select 'anon sans droit', not has_function_privilege('anon', 'public.link_unmatched(uuid, text)', 'execute');

-- Le staff rattache.
set local role authenticated;
select set_config('request.jwt.claims', '{"app_metadata":{"role":"admin"}}', true);
select public.link_unmatched('00000000-0000-0000-0000-0000000000b1', '0000002B');
reset role;

insert into t select 'signal créé et validé',
  exists (select 1 from public.reports where school_uai = '0000002B' and status = 'filtrant'
          and moderation = 'validated' and source_type = 'presse' and source_domain = 'exemple-journal.fr'
          and source_id = '00000000-0000-0000-0000-0000000000a1');
insert into t select 'extraction retirée', not exists (select 1 from public.unmatched_extractions where id = '00000000-0000-0000-0000-0000000000b1');
insert into t select 'visible sur la carte', exists (select 1 from public.school_current_status where uai = '0000002B' and status = 'filtrant');

-- Lycée inexistant refusé.
insert into public.unmatched_extractions (id, school_name, city, status, source_url, observed_at)
values ('00000000-0000-0000-0000-0000000000b2', 'X', null, 'bloque', 'https://a.fr/x', now());
do $$ begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"app_metadata":{"role":"admin"}}', true);
  begin
    perform public.link_unmatched('00000000-0000-0000-0000-0000000000b2', '9999999Z');
    raise exception 'lycée inexistant accepté';
  exception when no_data_found then null;
  end;
end $$;
reset role;

select name, ok from t;
do $$ declare f text; begin
  select string_agg(name, ', ') into f from t where ok is not true;
  if f is not null then raise exception 'ÉCHEC : %', f; end if;
end $$;
rollback;
