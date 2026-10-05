begin;
create temp table t (name text, ok boolean);
grant all on t to anon, authenticated;

insert into public.reports (school_uai, status, source_type, source_url, source_domain, moderation, observed_at) values
  ('0000001A', 'bloque',   'collecteur', 'https://exemple.fr/p1', 'exemple.fr', 'validated', now() - interval '3 days'),
  ('0000001A', 'leve',     'collecteur', 'https://exemple.fr/p2', 'exemple.fr', 'validated', now() - interval '2 days'),
  ('0000001A', 'filtrant', 'collecteur', 'https://exemple.fr/p3', 'exemple.fr', 'validated', now() - interval '1 day'),
  ('0000002B', 'bloque',   'collecteur', 'https://exemple.fr/p4', 'exemple.fr', 'validated', now() - interval '20 days'),
  ('0000003C', 'bloque',   'collecteur', 'https://exemple.fr/p5', 'exemple.fr', 'pending',   now() - interval '1 day');

set local role anon;
insert into t select 'statut le plus fort de la période', status = 'bloque'
  from public.school_status_since(now() - interval '7 days') where uai = '0000001A';
insert into t select 'jours de mobilisation (hors levé)', signal_days = 2
  from public.school_status_since(now() - interval '7 days') where uai = '0000001A';
insert into t select 'dernier signal', last_signal_at > now() - interval '25 hours'
  from public.school_status_since(now() - interval '7 days') where uai = '0000001A';
insert into t select 'hors période exclu', not exists (
  select 1 from public.school_status_since(now() - interval '7 days') where uai = '0000002B');
insert into t select 'depuis le début inclus', exists (
  select 1 from public.school_status_since(now() - interval '30 days') where uai = '0000002B');
insert into t select 'non validé invisible', not exists (
  select 1 from public.school_status_since(now() - interval '30 days') where uai = '0000003C');
reset role;

-- Réglages : réservé aux admins, valeurs contrôlées.
insert into t select 'début du mouvement par défaut', exists (select 1 from public.app_settings where key = 'movement_start');
insert into t select 'anon ne peut pas régler', not has_function_privilege('anon', 'public.admin_set_setting(text, text)', 'execute');
set local role authenticated;
select set_config('request.jwt.claims', '{"app_metadata":{"role":"admin"}}', true);
select public.admin_set_setting('status_ttl_hours', '12');
select public.admin_set_setting('movement_start', '2026-09-10');
reset role;
insert into t select 'admin règle le direct', (select value from public.app_settings where key = 'status_ttl_hours') = '12';
insert into t select 'admin règle le début', (select value from public.app_settings where key = 'movement_start') = '2026-09-10';
do $$ begin
  perform public.admin_set_setting('status_ttl_hours', 'abc');
  raise exception 'valeur invalide acceptée';
exception when invalid_parameter_value or insufficient_privilege then null; end $$;
do $$ begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"app_metadata":{"role":"admin"}}', true);
  begin
    perform public.admin_set_setting('status_ttl_hours', '500');
    raise exception 'hors bornes accepté';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.admin_set_setting('movement_start', '2999-01-01');
    raise exception 'date future acceptée';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.admin_set_setting('autre', '1');
    raise exception 'clé inconnue acceptée';
  exception when invalid_parameter_value then null; end;
  perform set_config('request.jwt.claims', '{"app_metadata":{"role":"user"}}', true);
  begin
    perform public.admin_set_setting('status_ttl_hours', '6');
    raise exception 'non-admin accepté';
  exception when insufficient_privilege then null; end;
end $$;
insert into t select 'validations', true;
-- Une vérification sur une ligne absente ne s'inscrirait pas : on compte.
insert into t select 'toutes les vérifications présentes', (select count(*) from t) = 11;

select name, ok from t;
do $$ declare f text; begin
  select string_agg(name, ', ') into f from t where ok is not true;
  if f is not null then raise exception 'ÉCHEC : %', f; end if;
end $$;
rollback;
