begin;
create temp table t (name text, ok boolean);
insert into t select 'trigger auto_validate fermé à anon',
  not has_function_privilege('anon', 'public.reports_auto_validate()', 'execute');
insert into t select 'trigger promote_concordant fermé aux comptes',
  not has_function_privilege('authenticated', 'public.reports_promote_concordant()', 'execute');
insert into t select 'vue en lecture seule',
  not has_table_privilege('anon', 'public.school_current_status', 'update')
  and has_table_privilege('anon', 'public.school_current_status', 'select');
insert into t select 'purge des positions fermée au public',
  not has_function_privilege('anon', 'public.purge_old_submissions()', 'execute');
insert into t select 'toutes les vérifications présentes', (select count(*) from t) = 4;
select name, ok from t;
do $$ declare f text; begin
  select string_agg(name, ', ') into f from t where ok is not true;
  if f is not null then raise exception 'ÉCHEC : %', f; end if;
end $$;
rollback;
