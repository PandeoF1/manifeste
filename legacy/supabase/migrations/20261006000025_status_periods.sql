-- Périodes de consultation : la carte montre par défaut le direct (status_ttl_hours), mais on
-- peut remonter sur 24 h, 7 jours ou depuis le début du mouvement (movement_start, réglable).

insert into public.app_settings (key, value) values ('movement_start', '2026-09-14')
on conflict (key) do nothing;

-- Lycées ayant eu au moins un signal validé depuis p_since. Le statut retenu est le plus fort
-- de la période (bloqué > barrage filtrant > levé) : « ce lycée a été bloqué ».
create or replace function public.school_status_since(p_since timestamptz)
returns table (
  uai text, name text, city text, department text, academy text,
  lat double precision, lng double precision,
  status public.report_status, last_signal_at timestamptz, source_count int, signal_days int
)
language sql stable
security invoker
set search_path = ''
as $$
  with period as (
    select r.*
    from public.reports r
    where r.moderation = 'validated'
      -- Au plus un an en arrière, et pas de signal daté dans le futur.
      and r.observed_at > greatest(p_since, now() - interval '366 days')
      and r.observed_at <= now() + interval '10 minutes'
  ),
  agg as (
    select p.school_uai,
           (array_agg(p.status order by case p.status when 'bloque' then 0 when 'filtrant' then 1 else 2 end))[1] as status,
           max(p.observed_at) as last_signal_at,
           count(distinct public.report_source_key(p.source_id, p.source_domain))::int as source_count,
           count(distinct (p.observed_at at time zone 'Europe/Paris')::date)
             filter (where p.status <> 'leve')::int as signal_days
    from period p
    group by p.school_uai
  )
  select s.uai, s.name, s.city, s.department, s.academy,
         extensions.st_y(s.location::extensions.geometry),
         extensions.st_x(s.location::extensions.geometry),
         a.status, a.last_signal_at, a.source_count, a.signal_days
  from agg a
  join public.schools s on s.uai = a.school_uai
  order by a.last_signal_at desc
$$;
grant execute on function public.school_status_since(timestamptz) to anon, authenticated;

-- Réglages modifiables depuis l'admin, avec validation.
create or replace function public.admin_set_setting(p_key text, p_value text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'réservé aux administrateurs' using errcode = '42501';
  end if;
  case p_key
    when 'status_ttl_hours' then
      if not coalesce(case when p_value ~ '^\d{1,3}$' then p_value::int between 1 and 168 end, false) then
        raise exception 'Durée du direct : entre 1 et 168 heures.' using errcode = '22023';
      end if;
    when 'concordance_window_hours' then
      if not coalesce(case when p_value ~ '^\d{1,2}$' then p_value::int between 1 and 24 end, false) then
        raise exception 'Fenêtre de concordance : entre 1 et 24 heures.' using errcode = '22023';
      end if;
    when 'movement_start' then
      if not coalesce(case when p_value ~ '^\d{4}-\d{2}-\d{2}$' then
           p_value::date between date '2020-01-01' and (now() at time zone 'Europe/Paris')::date end, false) then
        raise exception 'Début du mouvement : une date passée (AAAA-MM-JJ).' using errcode = '22023';
      end if;
    else
      raise exception 'Réglage inconnu : %', p_key using errcode = '22023';
  end case;
  insert into public.app_settings (key, value) values (p_key, p_value)
  on conflict (key) do update set value = excluded.value;
end
$$;
revoke execute on function public.admin_set_setting(text, text) from public, anon;
grant execute on function public.admin_set_setting(text, text) to authenticated;
