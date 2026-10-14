-- Stats : zoom par période (2 h, 24 h, 7 j, 30 j, 90 j) avec des courbes.
--   * pages vues par tranches de 5 minutes (au lieu d'une heure) ;
--   * heure de première visite du jour (courbe des nouveaux visiteurs ; effacée la nuit
--     avec l'empreinte, comme avant) ;
--   * nombre de personnes en ligne relevé chaque minute (gardé 14 jours).

alter table public.analytics_visitors add column first_seen timestamptz not null default now();

create table public.analytics_online (
  minute timestamptz primary key,
  online integer not null
);
alter table public.analytics_online enable row level security;
revoke all on public.analytics_online from anon, authenticated;

create or replace function public.record_beacon(
  p_ip text,
  p_page text,
  p_view boolean,
  p_metrics jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_salt text;
  v_page text := case when p_page in ('carte', 'liste', 'lycee', 'signaler', 'a-propos') then p_page else 'autre' end;
  m jsonb;
  v_metric text;
  v_value real;
begin
  if p_view then
    insert into public.daily_salts (day, salt)
    values (current_date, encode(extensions.gen_random_bytes(32), 'hex'))
    on conflict (day) do nothing;
    select salt into v_salt from public.daily_salts where day = current_date;
    insert into public.analytics_visitors (day, visitor)
    values (
      current_date,
      encode(extensions.digest(v_salt || '|visite|' || coalesce(p_ip, ''), 'sha256'), 'hex')
    )
    on conflict do nothing;
    -- Tranches de 5 minutes (la colonne garde son nom « hour »).
    insert into public.analytics_pageviews (hour, page, views)
    values (date_bin('5 minutes', now(), timestamptz '2000-01-01'), v_page, 1)
    on conflict (hour, page) do update set views = public.analytics_pageviews.views + 1;
  end if;

  if jsonb_typeof(p_metrics) = 'array' then
    for m in select * from jsonb_array_elements(p_metrics) limit 12 loop
      v_metric := m->>'name';
      v_value := (m->>'value')::real;
      if v_metric in ('LCP', 'INP', 'FCP', 'TTFB', 'API') and v_value between 0 and 60000
         or v_metric = 'CLS' and v_value between 0 and 10 then
        insert into public.analytics_vitals (page, metric, value) values (v_page, v_metric, v_value);
      end if;
    end loop;
  end if;
end;
$$;

/** Relevé « en ligne » de la minute (cron). */
create or replace function public.snapshot_online()
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.analytics_online (minute, online)
  select date_trunc('minute', now()), count(*)
  from public.analytics_live where seen_at >= now() - interval '100 seconds'
  on conflict (minute) do update set online = excluded.online;
$$;
revoke execute on function public.snapshot_online() from public, anon, authenticated;

create or replace function public.rollup_analytics()
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.analytics_daily (day, visitors)
  select day, count(*) from public.analytics_visitors where day < current_date group by day
  on conflict (day) do update set visitors = excluded.visitors;
  delete from public.analytics_visitors where day < current_date;
  delete from public.analytics_vitals where at < now() - interval '30 days';
  delete from public.analytics_pageviews where hour < now() - interval '120 days';
  delete from public.analytics_online where minute < now() - interval '14 days';
$$;

/**
 * Courbes d'une période : pages vues, visiteurs (nouveaux par tranche, ou uniques par jour),
 * pic « en ligne », Web Vitals (p75) ; plus le détail par page et un résumé.
 */
create or replace function public.admin_analytics_series(p_range text default '24h')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_span interval;
  v_step interval;
  v_start timestamptz;
  v_end timestamptz := now();
  v_daily boolean;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  case p_range
    when '2h' then v_span := interval '2 hours'; v_step := interval '5 minutes';
    when '7d' then v_span := interval '7 days'; v_step := interval '1 hour';
    when '30d' then v_span := interval '30 days'; v_step := interval '1 day';
    when '90d' then v_span := interval '90 days'; v_step := interval '1 day';
    else v_span := interval '24 hours'; v_step := interval '15 minutes';
  end case;
  v_daily := v_step = interval '1 day';
  -- Tranches alignées (jours : minuit à Paris).
  if v_daily then
    v_start := ((now() at time zone 'Europe/Paris')::date - (extract(day from v_span)::int - 1))
               at time zone 'Europe/Paris';
  else
    v_start := date_bin(v_step, now() - v_span, timestamptz '2000-01-01') + v_step;
  end if;

  return (
    with buckets as (
      select b as t, case when v_daily then b + interval '1 day' else b + v_step end as t_end
      from generate_series(v_start, v_end, v_step) b
    ),
    views as (
      select bk.t, coalesce(sum(p.views), 0)::int as v
      from buckets bk
      left join public.analytics_pageviews p on p.hour >= bk.t and p.hour < bk.t_end
      group by bk.t
    ),
    visitors as (
      select bk.t,
        case
          -- Jours : total archivé, ou compte en cours pour aujourd'hui.
          when v_daily then coalesce(
            (select d.visitors from public.analytics_daily d
              where d.day = (bk.t at time zone 'Europe/Paris')::date),
            case when (bk.t at time zone 'Europe/Paris')::date >= current_date
              then (select count(*) from public.analytics_visitors v where v.day = current_date) end)
          -- Infra-journalier : nouveaux visiteurs du jour (empreintes des jours passés effacées).
          when bk.t_end > current_date::timestamptz then
            (select count(*) from public.analytics_visitors v
              where v.first_seen >= bk.t and v.first_seen < bk.t_end)
          else null
        end::int as v
      from buckets bk
    ),
    online as (
      select bk.t, max(o.online) as v
      from buckets bk
      left join public.analytics_online o on o.minute >= bk.t and o.minute < bk.t_end
      group by bk.t
    ),
    vitals as (
      select bk.t,
        percentile_cont(0.75) within group (order by a.value) filter (where a.metric = 'LCP') as lcp,
        percentile_cont(0.75) within group (order by a.value) filter (where a.metric = 'INP') as inp,
        percentile_cont(0.75) within group (order by a.value) filter (where a.metric = 'API') as api
      from buckets bk
      left join public.analytics_vitals a on a.at >= bk.t and a.at < bk.t_end
      group by bk.t
    )
    select jsonb_build_object(
      'range', p_range,
      'step_seconds', extract(epoch from v_step)::int,
      'points', coalesce((
        select jsonb_agg(jsonb_build_object(
          't', bk.t, 'views', vw.v, 'visitors', vs.v, 'online', o.v,
          'lcp', round(vt.lcp::numeric), 'inp', round(vt.inp::numeric), 'api', round(vt.api::numeric)
        ) order by bk.t)
        from buckets bk
        join views vw using (t) join visitors vs using (t) join online o using (t) join vitals vt using (t)
      ), '[]'::jsonb),
      'pages', coalesce((
        select jsonb_agg(jsonb_build_object('page', page, 'views', views) order by views desc)
        from (select page, sum(views)::int as views from public.analytics_pageviews
              where hour >= v_start group by page) x
      ), '[]'::jsonb),
      'summary', jsonb_build_object(
        'views', (select coalesce(sum(views), 0) from public.analytics_pageviews where hour >= v_start),
        'peak_online', (select max(online) from public.analytics_online where minute >= v_start),
        'peak_online_at', (select minute from public.analytics_online where minute >= v_start
                           order by online desc, minute desc limit 1),
        'lcp_p75', (select round(percentile_cont(0.75) within group (order by value)::numeric)
                    from public.analytics_vitals where metric = 'LCP' and at >= v_start),
        'api_p75', (select round(percentile_cont(0.75) within group (order by value)::numeric)
                    from public.analytics_vitals where metric = 'API' and at >= v_start)
      )
    )
  );
end;
$$;
revoke execute on function public.admin_analytics_series(text) from public, anon;
grant execute on function public.admin_analytics_series(text) to authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('snapshot-online', '* * * * *', 'select public.snapshot_online()');
  end if;
end
$$;
