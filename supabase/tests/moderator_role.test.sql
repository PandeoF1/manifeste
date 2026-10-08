-- Rôle modérateur : il valide, rien d'autre.
begin;
create temp table t (name text, ok boolean);
grant all on t to authenticated;

insert into public.reports (id, school_uai, status, source_type, source_url, source_domain, observed_at, moderation)
values
  ('00000000-0000-0000-0000-0000000000f1', '0000003C', 'bloque', 'collecteur', 'https://exemple.test/a', 'exemple.test', now(), 'pending'),
  ('00000000-0000-0000-0000-0000000000f2', '0000003C', 'bloque', 'collecteur', 'https://exemple.test/b', 'exemple.test', now(), 'pending'),
  ('00000000-0000-0000-0000-0000000000f3', '0000003C', 'leve', 'collecteur', 'https://exemple.test/c', 'exemple.test', now(), 'validated');
insert into public.report_submissions (report_id, photo_path, lat, lng, distance_m)
values ('00000000-0000-0000-0000-0000000000f2', 'orig/f2.jpg', 43.5, 3.5, 40);

set local role authenticated;
select set_config('request.jwt.claims', '{"app_metadata":{"role":"moderator"}}', true);

create temp table pend as select public.moderator_pending_reports() j;
grant all on pend to authenticated;
insert into t select 'modérateur : voit les 2 signalements en attente',
  (select jsonb_array_length(j) = 2 from pend);
insert into t select 'modérateur : ni position ni identifiant de source',
  (select position('"lat"' in j::text) = 0 and position('"lng"' in j::text) = 0
      and position('source_id' in j::text) = 0 from pend);
insert into t select 'modérateur : voit la photo et la distance',
  (select bool_or(p->>'photo_path' = 'orig/f2.jpg' and (p->>'distance_m')::int = 40)
   from pend, jsonb_array_elements(j) p);

select public.moderator_approve_report('00000000-0000-0000-0000-0000000000f1');
select public.moderator_approve_report('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f2.jpg');

-- Interdits : rejet direct, suppression, lecture des tables, autres fonctions du staff.
do $$ begin
  begin
    update public.reports set moderation = 'rejected' where id = '00000000-0000-0000-0000-0000000000f3';
    if found then raise exception 'rejet direct possible'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.reports where id = '00000000-0000-0000-0000-0000000000f3';
    if found then raise exception 'suppression possible'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_delete_report('00000000-0000-0000-0000-0000000000f3');
    raise exception 'admin_delete_report accessible';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_update_report('00000000-0000-0000-0000-0000000000f3', p_moderation => 'rejected');
    raise exception 'admin_update_report accessible';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.moderator_approve_report('00000000-0000-0000-0000-0000000000f1');
    raise exception 'double validation acceptée';
  exception when no_data_found then null;
  end;
  begin
    perform public.moderator_approve_report('00000000-0000-0000-0000-0000000000f3', 'autre.jpg');
    raise exception 'nom de photo libre';
  exception when invalid_parameter_value then null;
  end;
end $$;
insert into t select 'modérateur : aucune action interdite possible', true;

insert into t select 'modérateur : ne lit pas les signalements masqués ou autres tables',
  (select count(*) = 0 from public.unmatched_extractions)
  and (select count(*) = 0 from public.scrape_sources)
  and (select count(*) = 0 from public.report_submissions);

reset role;
insert into t select 'les deux signalements sont validés',
  (select count(*) = 2 from public.reports where id in (
    '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2') and moderation = 'validated');
insert into t select 'photo publiée enregistrée',
  (select photo_public_path = '00000000-0000-0000-0000-0000000000f2.jpg'
   from public.reports where id = '00000000-0000-0000-0000-0000000000f2');
insert into t select 'le signalement validé d''avant est inchangé',
  (select moderation = 'validated' from public.reports where id = '00000000-0000-0000-0000-0000000000f3');

-- Un visiteur ou un autre rôle n'a aucun accès.
set local role authenticated;
select set_config('request.jwt.claims', '{"app_metadata":{"role":"user"}}', true);
do $$ begin
  begin
    perform public.moderator_pending_reports();
    raise exception 'liste accessible à un visiteur';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.moderator_approve_report('00000000-0000-0000-0000-0000000000f1');
    raise exception 'validation par un visiteur';
  exception when insufficient_privilege then null;
  end;
end $$;
insert into t select 'compte ordinaire : refusé', true;
reset role;

-- L'admin garde l'accès.
set local role authenticated;
select set_config('request.jwt.claims', '{"app_metadata":{"role":"admin"}}', true);
insert into t select 'admin : accès à la liste', (select jsonb_array_length(public.moderator_pending_reports()) >= 0);
reset role;

select name, ok from t;
do $$ declare f text; begin
  select string_agg(name, ', ') into f from t where ok is not true;
  if f is not null then raise exception 'ÉCHEC : %', f; end if;
end $$;
rollback;
