-- Consommation de tokens de l'IA (Gemini), pour les graphiques de l'admin (onglet « Coût IA »).
-- Une ligne par heure, tâche et modèle ; les Edge Functions et le script de rattrapage y ajoutent
-- ce que chaque appel a consommé. Aucune donnée personnelle : des compteurs.
create table public.ai_usage (
  bucket timestamptz not null,
  task text not null check (task in ('extraction', 'media', 'reanalyse', 'backfill')),
  model text not null check (length(model) between 1 and 80),
  calls integer not null default 0 check (calls >= 0),
  prompt_tokens bigint not null default 0 check (prompt_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  -- Réflexion : facturée comme de la sortie, mais comptée à part pour voir ce qu'elle pèse.
  thoughts_tokens bigint not null default 0 check (thoughts_tokens >= 0),
  primary key (bucket, task, model)
);

alter table public.ai_usage enable row level security;
create policy "admin lit" on public.ai_usage for select to authenticated using (public.is_admin());
revoke all on public.ai_usage from anon;
revoke insert, update, delete on public.ai_usage from authenticated;

-- Ajoute une consommation à l'heure en cours. Appelée avec la clé service (Edge Functions,
-- script de rattrapage) : p_rows = [{ task, model, calls, prompt_tokens, output_tokens, thoughts_tokens }].
create or replace function public.record_ai_usage(p_rows jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.ai_usage (bucket, task, model, calls, prompt_tokens, output_tokens, thoughts_tokens)
  select date_trunc('hour', now()),
         r ->> 'task',
         left(r ->> 'model', 80),
         greatest(coalesce((r ->> 'calls')::integer, 0), 0),
         greatest(coalesce((r ->> 'prompt_tokens')::bigint, 0), 0),
         greatest(coalesce((r ->> 'output_tokens')::bigint, 0), 0),
         greatest(coalesce((r ->> 'thoughts_tokens')::bigint, 0), 0)
  from jsonb_array_elements(case when jsonb_typeof(p_rows) = 'array' then p_rows else '[]'::jsonb end) r
  on conflict (bucket, task, model) do update set
    calls = public.ai_usage.calls + excluded.calls,
    prompt_tokens = public.ai_usage.prompt_tokens + excluded.prompt_tokens,
    output_tokens = public.ai_usage.output_tokens + excluded.output_tokens,
    thoughts_tokens = public.ai_usage.thoughts_tokens + excluded.thoughts_tokens
$$;
revoke execute on function public.record_ai_usage(jsonb) from public, anon, authenticated;
grant execute on function public.record_ai_usage(jsonb) to service_role;

-- Graphiques de l'admin : un total par jour (heure de Paris), tâche et modèle.
create or replace function public.admin_ai_usage(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 120);
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'day', d.day, 'task', d.task, 'model', d.model, 'calls', d.calls,
        'prompt_tokens', d.prompt_tokens, 'output_tokens', d.output_tokens,
        'thoughts_tokens', d.thoughts_tokens
      ) order by d.day, d.task, d.model
    )
    from (
      select (bucket at time zone 'Europe/Paris')::date as day, task, model,
             sum(calls)::bigint as calls, sum(prompt_tokens) as prompt_tokens,
             sum(output_tokens) as output_tokens, sum(thoughts_tokens) as thoughts_tokens
      from public.ai_usage
      where bucket >= (((now() at time zone 'Europe/Paris')::date - (v_days - 1))::timestamp at time zone 'Europe/Paris')
      group by 1, 2, 3
    ) d
  ), '[]'::jsonb);
end;
$$;
revoke execute on function public.admin_ai_usage(integer) from public, anon;
grant execute on function public.admin_ai_usage(integer) to authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'purge-ai-usage',
      '23 3 * * *',
      $cron$ delete from public.ai_usage where bucket < now() - interval '120 days'; $cron$
    );
  end if;
end
$$;
