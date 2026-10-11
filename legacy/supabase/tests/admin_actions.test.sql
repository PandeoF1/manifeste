begin;
create temp table t (name text, ok boolean);
grant all on t to authenticated;

insert into public.reports (id, school_uai, status, source_type, source_url, source_domain, moderation, observed_at) values
  ('00000000-0000-0000-0000-0000000000f1', '0000003C', 'bloque', 'collecteur', 'https://exemple.fr/1', 'exemple.fr', 'validated', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-0000000000f2', '0000003C', 'bloque', 'collecteur', 'https://exemple.fr/2', 'exemple.fr', 'validated', now()),
  ('00000000-0000-0000-0000-0000000000f3', '0000003C', 'bloque', 'utilisateur', null, null, 'validated', now()),
  ('00000000-0000-0000-0000-0000000000f4', '0000003C', 'filtrant', 'collecteur', 'https://exemple.fr/4', 'exemple.fr', 'validated', now());

-- Non admin : refusé.
do $$ begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"app_metadata":{"role":"user"}}', true);
  begin
    perform public.admin_delete_report('00000000-0000-0000-0000-0000000000f1');
    raise exception 'non-admin a pu supprimer';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
insert into t select 'anon sans droit', not has_function_privilege('anon', 'public.admin_delete_report(uuid)', 'execute');

set local role authenticated;
select set_config('request.jwt.claims', '{"app_metadata":{"role":"admin"}}', true);
select public.admin_update_report('00000000-0000-0000-0000-0000000000f1', '0000005E', 'leve', null, 'pending');
select public.admin_delete_report('00000000-0000-0000-0000-0000000000f2');
select public.admin_report_to_unmatched('00000000-0000-0000-0000-0000000000f4');
reset role;

insert into t select 'modifié (lycée, statut, modération)',
  (select school_uai = '0000005E' and status = 'leve' and moderation = 'pending' from public.reports where id = '00000000-0000-0000-0000-0000000000f1');
insert into t select 'supprimé', not exists (select 1 from public.reports where id = '00000000-0000-0000-0000-0000000000f2');
insert into t select 'renvoyé à l''IA : signal retiré', not exists (select 1 from public.reports where id = '00000000-0000-0000-0000-0000000000f4');
insert into t select 'renvoyé à l''IA : extraction créée',
  exists (select 1 from public.unmatched_extractions where source_url = 'https://exemple.fr/4' and city is null and status = 'filtrant');

-- Signalement sur place sans lien : refus de renvoi à l'IA ; heure future refusée.
do $$ begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"app_metadata":{"role":"admin"}}', true);
  begin
    perform public.admin_report_to_unmatched('00000000-0000-0000-0000-0000000000f3');
    raise exception 'renvoi sans lien accepté';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.admin_update_report('00000000-0000-0000-0000-0000000000f3', null, null, now() + interval '2 days', null);
    raise exception 'heure future acceptée';
  exception when invalid_parameter_value then null;
  end;
end $$;
reset role;

select name, ok from t;
do $$ declare f text; begin
  select string_agg(name, ', ') into f from t where ok is not true;
  if f is not null then raise exception 'ÉCHEC : %', f; end if;
end $$;
rollback;
