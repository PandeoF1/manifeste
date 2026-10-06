-- Statistiques du site, maison et anonymes (page admin « Stats ») :
--   * visiteurs uniques du jour : empreinte sha256(sel du jour | « visite » | IP). Le sel est
--     détruit chaque nuit (daily_salts) et les empreintes de la veille sont réduites à un
--     simple total, donc impossible de suivre quelqu'un d'un jour à l'autre ;
--   * pages vues par heure et par type de page (carte, liste, lycée, signaler, à propos) ;
--   * mesures de performance (Web Vitals, latence de l'API), sans navigateur, OS, référent
--     ni adresse de page précise. Rien n'est relié à un visiteur ;
--   * « en ligne » : onglets ouverts et visibles, signalés toutes les 45 s avec un identifiant
--     aléatoire tiré à l'ouverture de l'onglet (gardé en mémoire, jamais dans le navigateur),
--     effacé après 10 minutes.
-- Écrit uniquement par l'Edge Function « beacon » (rôle service) ; lu par les admins.

create table public.analytics_visitors (
  day date not null,
  visitor text not null,
  primary key (day, visitor)
);

create table public.analytics_daily (
  day date primary key,
  visitors integer not null default 0
);

create table public.analytics_pageviews (
  hour timestamptz not null,
  page text not null check (page in ('carte', 'liste', 'lycee', 'signaler', 'a-propos', 'autre')),
  views integer not null default 0,
  primary key (hour, page)
);

create table public.analytics_vitals (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  page text not null check (page in ('carte', 'liste', 'lycee', 'signaler', 'a-propos', 'autre')),
  metric text not null check (metric in ('LCP', 'INP', 'CLS', 'FCP', 'TTFB', 'API')),
  value real not null
);
create index analytics_vitals_at_idx on public.analytics_vitals (at);

create table public.analytics_live (
  session uuid primary key,
  page text not null check (page in ('carte', 'liste', 'lycee', 'signaler', 'a-propos', 'autre')),
  seen_at timestamptz not null default now()
);
create index analytics_live_seen_idx on public.analytics_live (seen_at);

alter table public.analytics_visitors enable row level security;
alter table public.analytics_daily enable row level security;
alter table public.analytics_pageviews enable row level security;
alter table public.analytics_vitals enable row level security;
alter table public.analytics_live enable row level security;
revoke all on public.analytics_visitors, public.analytics_daily, public.analytics_pageviews,
  public.analytics_vitals, public.analytics_live from anon, authenticated;

/** Signal « onglet ouvert » (public : aucun identifiant durable, aucune IP). */
create or replace function public.ping_live(p_session uuid, p_page text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.analytics_live where seen_at < now() - interval '10 minutes';
  insert into public.analytics_live (session, page, seen_at)
  values (
    p_session,
    case when p_page in ('carte', 'liste', 'lycee', 'signaler', 'a-propos') then p_page else 'autre' end,
    now()
  )
  on conflict (session) do update set page = excluded.page, seen_at = excluded.seen_at;
$$;
revoke execute on function public.ping_live(uuid, text) from public;
grant execute on function public.ping_live(uuid, text) to anon, authenticated;

/** Enregistre un envoi du navigateur : page vue (facultative) et mesures. */
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
    insert into public.analytics_pageviews (hour, page, views)
    values (date_trunc('hour', now()), v_page, 1)
    on conflict (hour, page) do update set views = public.analytics_pageviews.views + 1;
  end if;

  if jsonb_typeof(p_metrics) = 'array' then
    for m in select * from jsonb_array_elements(p_metrics) limit 12 loop
      v_metric := m->>'name';
      v_value := (m->>'value')::real;
      -- Bornes larges : on écarte les valeurs aberrantes (onglet en veille, horloge…).
      if v_metric in ('LCP', 'INP', 'FCP', 'TTFB', 'API') and v_value between 0 and 60000
         or v_metric = 'CLS' and v_value between 0 and 10 then
        insert into public.analytics_vitals (page, metric, value) values (v_page, v_metric, v_value);
      end if;
    end loop;
  end if;
end;
$$;
revoke execute on function public.record_beacon(text, text, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.record_beacon(text, text, boolean, jsonb) to service_role;

/** Réduit les jours passés à un total, puis efface empreintes et anciennes mesures. */
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
$$;
revoke execute on function public.rollup_analytics() from public, anon, authenticated;

/** Tableau de bord admin : un seul appel. */
create or replace function public.admin_analytics(p_days integer default 30)
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
  return jsonb_build_object(
    'live', (select count(*) from public.analytics_live where seen_at >= now() - interval '100 seconds'),
    'live_pages', coalesce((
      select jsonb_object_agg(page, n) from (
        select page, count(*) as n from public.analytics_live
        where seen_at >= now() - interval '100 seconds' group by page
      ) l
    ), '{}'::jsonb),
    'today_visitors', (select count(*) from public.analytics_visitors where day = current_date),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'visitors', d.visitors, 'views', d.views) order by d.day)
      from (
        select g.day::date as day,
          coalesce(ad.visitors, case when g.day::date = current_date
            then (select count(*) from public.analytics_visitors where day = current_date) end, 0) as visitors,
          coalesce((select sum(views) from public.analytics_pageviews
            where hour >= g.day and hour < g.day + interval '1 day'), 0) as views
        from generate_series(current_date - (v_days - 1), current_date, interval '1 day') g(day)
        left join public.analytics_daily ad on ad.day = g.day::date
      ) d
    ), '[]'::jsonb),
    'hourly', coalesce((
      select jsonb_agg(jsonb_build_object('hour', h.hour, 'views', h.views) order by h.hour)
      from (
        select g.hour, coalesce(sum(p.views), 0) as views
        from generate_series(date_trunc('hour', now()) - interval '23 hours', date_trunc('hour', now()), interval '1 hour') g(hour)
        left join public.analytics_pageviews p on p.hour = g.hour
        group by g.hour
      ) h
    ), '[]'::jsonb),
    'pages', coalesce((
      select jsonb_agg(jsonb_build_object('page', page, 'views', views) order by views desc)
      from (select page, sum(views) as views from public.analytics_pageviews
            where hour >= now() - interval '24 hours' group by page) x
    ), '[]'::jsonb),
    'vitals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'metric', metric, 'n', n, 'p50', p50, 'p75', p75, 'p95', p95, 'p75_prev', p75_prev))
      from (
        select metric,
          count(*) filter (where at >= now() - interval '24 hours') as n,
          percentile_cont(0.5) within group (order by value) filter (where at >= now() - interval '24 hours') as p50,
          percentile_cont(0.75) within group (order by value) filter (where at >= now() - interval '24 hours') as p75,
          percentile_cont(0.95) within group (order by value) filter (where at >= now() - interval '24 hours') as p95,
          percentile_cont(0.75) within group (order by value)
            filter (where at < now() - interval '24 hours' and at >= now() - interval '7 days') as p75_prev
        from public.analytics_vitals
        where at >= now() - interval '7 days'
        group by metric
      ) v
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.admin_analytics(integer) from public, anon;
grant execute on function public.admin_analytics(integer) to authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    -- Avant la purge des sels (00:05) : les empreintes de la veille deviennent un total.
    perform cron.schedule('rollup-analytics', '2 0 * * *', 'select public.rollup_analytics()');
  end if;
end
$$;
