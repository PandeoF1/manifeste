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


-- Étendue : stats, médias, établissements proposés, journal.
insert into public.media_analyses (url, domain, about_movement, mentions_demands, focus, incidents, police_violence, tone)
values ('https://exemple.test/media', 'exemple.test', true, false, 'mixte', false, false, 'neutre');
insert into public.school_proposals (id, name, city, status, lat, lng, photo_path)
select 'bbbbbbbb-0000-0000-0000-0000000000b1', 'lycée des tests', 'Testville', 'bloque', lat, lng, 'orig/secret.jpg'
from (select extensions.st_y(location::extensions.geometry) lat, extensions.st_x(location::extensions.geometry) lng
      from public.schools where location is not null order by uai limit 1) x;
insert into public.school_proposals (id, name, city, status, lat, lng)
select 'bbbbbbbb-0000-0000-0000-0000000000b2', 'lycée à rejeter', 'Ailleurs', 'filtrant', lat, lng
from (select extensions.st_y(location::extensions.geometry) lat, extensions.st_x(location::extensions.geometry) lng
      from public.schools where location is not null order by uai limit 1) x;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","email":"moderator@example.org","app_metadata":{"role":"moderator"}}', true);
insert into t select 'modérateur : stats lisibles', (select public.admin_analytics(7) is not null)
  and (select public.admin_analytics_series('24h') is not null);
insert into t select 'modérateur : voit les propositions', (select jsonb_array_length(public.admin_school_proposals()) = 2);
insert into t select 'modérateur : médias lisibles',
  (select count(*) = 1 from public.media_analyses);
do $$ begin
  begin
    delete from public.media_analyses;
    if found then raise exception 'suppression des médias possible'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.school_proposals where id = 'bbbbbbbb-0000-0000-0000-0000000000b2';
    if found then raise exception 'rejet direct possible'; end if;
  exception when insufficient_privilege then null;
  end;
end $$;
create temp table made as
  select public.admin_resolve_school_proposal('bbbbbbbb-0000-0000-0000-0000000000b1', null, 'Lycée des Tests', 'Testville') uai;
grant all on made to authenticated;
insert into t select 'modérateur : ajoute un établissement', (select uai ~ '^999[0-9]{4}Z$' from made);
do $$ begin
  if exists (select 1 from public.moderation_audit) then raise exception 'journal lisible'; end if;
  begin
    insert into public.moderation_audit (action) values ('truque');
    raise exception 'journal modifiable';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.log_moderation_action('x', 'y', null, null);
    raise exception 'journal inscriptible';
  exception when insufficient_privilege then null;
  end;
end $$;
insert into t select 'modérateur : ne lit ni ne modifie le journal', true;
reset role;

insert into t select 'journal : 3 actions avant les non rattachés',
  (select count(*) = 3 from public.moderation_audit);
insert into t select 'journal : auteur et courriel',
  (select bool_and(actor = '11111111-1111-1111-1111-111111111111' and actor_email = 'moderator@example.org')
   from public.moderation_audit);
insert into t select 'journal : de quoi défaire une validation',
  (select before->>'moderation' = 'pending' and after->>'moderation' = 'validated'
   from public.moderation_audit where action = 'valider_signalement' order by id limit 1);
insert into t select 'journal : l''ajout garde l''identifiant du lycée et du signal',
  (select after->>'school_uai' = (select uai from made) and (after->>'report_id') is not null
      and (after->>'school_created')::boolean
   from public.moderation_audit where action = 'ajouter_etablissement');
insert into t select 'journal : aucune position ni photo de visiteur',
  (select bool_and(position('"lat"' in (before::text || after::text)) = 0
      and position('"lng"' in (before::text || after::text)) = 0
      and position('secret' in (before::text || after::text)) = 0)
   from public.moderation_audit);
insert into t select 'médias intacts', (select count(*) = 1 from public.media_analyses);
insert into t select 'la proposition rejetée n''a pas bougé',
  exists (select 1 from public.school_proposals where id = 'bbbbbbbb-0000-0000-0000-0000000000b2');

set local role authenticated;
select set_config('request.jwt.claims', '{"app_metadata":{"role":"admin"}}', true);
insert into t select 'admin : lit le journal', (select count(*) = 3 from public.moderation_audit);
reset role;


-- Non rattachés : le modérateur lit et rattache, rien d'autre.
insert into public.scrape_sources (id, kind, identifier, label, source_type)
values ('00000000-0000-0000-0000-0000000000c1', 'rss', 'https://exemple.fr/feed', 'Flux', 'presse');
insert into public.unmatched_extractions (id, source_id, school_name, city, status, source_url, observed_at)
values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'Lycée', 'Besançon', 'filtrant', 'https://exemple-journal.test/a', now() - interval '20 minutes'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1', 'Lycée', 'Dijon', 'bloque', 'https://exemple-journal.test/b', now() - interval '10 minutes');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","email":"moderator@example.org","app_metadata":{"role":"moderator"}}', true);
insert into t select 'non rattachés : modérateur lit la liste', (select count(*) = 2 from public.unmatched_extractions);
select public.link_unmatched('00000000-0000-0000-0000-0000000000d1', '0000002B');
do $$ begin
  begin
    delete from public.unmatched_extractions where id = '00000000-0000-0000-0000-0000000000d2';
    if found then raise exception 'ignorer possible'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.retry_unmatched();
    raise exception 'réessai automatique accessible';
  exception when insufficient_privilege then null;
  end;
end $$;
insert into t select 'non rattachés : ni ignorer ni réessayer', true;
reset role;

insert into t select 'non rattachés : rattaché et validé',
  exists (select 1 from public.reports where source_url = 'https://exemple-journal.test/a'
          and school_uai = '0000002B' and moderation = 'validated')
  and not exists (select 1 from public.unmatched_extractions where id = '00000000-0000-0000-0000-0000000000d1');
insert into t select 'non rattachés : l''autre extraction reste', exists (select 1 from public.unmatched_extractions where id = '00000000-0000-0000-0000-0000000000d2');
insert into t select 'journal : rattachement tracé avec l''extraction d''origine',
  (select before->>'school_name' = 'Lycée' and before->>'source_url' = 'https://exemple-journal.test/a'
      and after->>'school_uai' = '0000002B' and (after->>'report_id') is not null
      and actor_email = 'moderator@example.org'
   from public.moderation_audit where action = 'rattacher_non_rattache');

select name, ok from t;
do $$ declare f text; begin
  select string_agg(name, ', ') into f from t where ok is not true;
  if f is not null then raise exception 'ÉCHEC : %', f; end if;
end $$;
rollback;
