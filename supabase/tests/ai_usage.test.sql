begin;
create temp table t (name text, ok boolean);
grant all on t to anon, authenticated;

-- Écriture : clé service seulement, les compteurs s'additionnent dans l'heure.
select public.record_ai_usage('[
  {"task":"extraction","model":"m1","calls":1,"prompt_tokens":1000,"output_tokens":100,"thoughts_tokens":50},
  {"task":"media","model":"m1","calls":2,"prompt_tokens":500,"output_tokens":20,"thoughts_tokens":0}
]'::jsonb);
select public.record_ai_usage('[{"task":"extraction","model":"m1","calls":1,"prompt_tokens":2000,"output_tokens":300,"thoughts_tokens":0}]'::jsonb);
select public.record_ai_usage('{"pas":"un tableau"}'::jsonb);
insert into t select 'une ligne par tâche et modèle', (select count(*) from public.ai_usage) = 2;
insert into t select 'les compteurs s''additionnent',
  (select calls = 2 and prompt_tokens = 3000 and output_tokens = 400 and thoughts_tokens = 50
   from public.ai_usage where task = 'extraction' and model = 'm1');

-- Droits.
insert into t select 'anon ne lit rien', not has_table_privilege('anon', 'public.ai_usage', 'select');
insert into t select 'authenticated ne peut pas écrire', not has_table_privilege('authenticated', 'public.ai_usage', 'insert');
insert into t select 'seul service_role enregistre',
  has_function_privilege('service_role', 'public.record_ai_usage(jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.record_ai_usage(jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.record_ai_usage(jsonb)', 'execute');

-- Lecture : admin seulement.
set local role authenticated;
select set_config('request.jwt.claims', '{"app_metadata":{"role":"admin"}}', true);
insert into t select 'admin lit la table', (select count(*) from public.ai_usage) = 2;
insert into t select 'admin_ai_usage agrège par jour',
  (select count(*) from jsonb_array_elements(public.admin_ai_usage(30))) = 2
  and (select (e ->> 'prompt_tokens')::bigint from jsonb_array_elements(public.admin_ai_usage(30)) e where e ->> 'task' = 'extraction') = 3000;
select set_config('request.jwt.claims', '{"app_metadata":{"role":"moderator"}}', true);
insert into t select 'un modérateur ne voit rien', (select count(*) from public.ai_usage) = 0;
do $$ begin
  perform public.admin_ai_usage(30);
  raise exception 'admin_ai_usage accessible à un non-admin';
exception when insufficient_privilege then null; end $$;
insert into t select 'admin_ai_usage refusée aux non-admins', true;
reset role;

-- Contrôle des valeurs.
do $$ begin
  insert into public.ai_usage (bucket, task, model) values (now(), 'inconnue', 'm');
  raise exception 'tâche invalide acceptée';
exception when check_violation then null; end $$;
insert into t select 'tâche contrôlée', true;
insert into t select 'toutes les vérifications présentes', (select count(*) from t) = 10;

select name, ok from t;
do $$ declare f text; begin
  select string_agg(name, ', ') into f from t where ok is not true;
  if f is not null then raise exception 'ÉCHEC : %', f; end if;
end $$;
rollback;
