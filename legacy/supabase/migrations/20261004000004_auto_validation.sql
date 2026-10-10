-- Clé identifiant une source : la source collectée si connue, sinon le domaine.
create or replace function public.report_source_key(p_source_id uuid, p_domain text)
returns text
language sql immutable
set search_path = ''
as $$
  select coalesce('src:' || p_source_id::text, 'dom:' || p_domain)
$$;

-- Règle de validation automatique, appliquée à l'insertion quel que soit l'émetteur.
--   1. source collectée marquée de confiance -> validated
--   2. domaine présent dans trusted_domains  -> validated
--   3. concordance : un autre report, d'une autre source, même lycée, même statut,
--      à moins de N heures (défaut 2 h) -> validated, et le report concordant aussi.
--      Deux reports 'utilisateur' ne suffisent pas à eux seuls (abus trop facile).
-- Sinon : pending. Un statut déjà fixé par un admin (service role) est respecté.
create or replace function public.reports_auto_validate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window interval := make_interval(hours => public.setting_int('concordance_window_hours', 2));
  v_key text := public.report_source_key(new.source_id, new.source_domain);
begin
  if new.moderation <> 'pending' then
    return new;
  end if;

  if new.source_id is not null and exists (
    select 1 from public.scrape_sources s where s.id = new.source_id and s.trusted
  ) then
    new.moderation := 'validated';
    return new;
  end if;

  if exists (select 1 from public.trusted_domains d where d.domain = new.source_domain) then
    new.moderation := 'validated';
    return new;
  end if;

  if exists (
    select 1
    from public.reports r
    where r.school_uai = new.school_uai
      and r.status = new.status
      and r.moderation <> 'rejected'
      and abs(extract(epoch from (r.observed_at - new.observed_at))) <= extract(epoch from v_window)
      and public.report_source_key(r.source_id, r.source_domain) <> v_key
      and not (r.source_type = 'utilisateur' and new.source_type = 'utilisateur')
  ) then
    new.moderation := 'validated';
  end if;

  return new;
end;
$$;

-- Promotion des reports concordants restés en attente.
create or replace function public.reports_promote_concordant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window interval := make_interval(hours => public.setting_int('concordance_window_hours', 2));
begin
  update public.reports r
  set moderation = 'validated'
  where r.moderation = 'pending'
    and r.id <> new.id
    and r.school_uai = new.school_uai
    and r.status = new.status
    and abs(extract(epoch from (r.observed_at - new.observed_at))) <= extract(epoch from v_window)
    and public.report_source_key(r.source_id, r.source_domain)
        <> public.report_source_key(new.source_id, new.source_domain)
    and not (r.source_type = 'utilisateur' and new.source_type = 'utilisateur');
  return null;
end;
$$;

create trigger reports_auto_validate
  before insert on public.reports
  for each row execute function public.reports_auto_validate();

create trigger reports_promote_concordant
  after insert on public.reports
  for each row
  when (new.moderation = 'validated')
  execute function public.reports_promote_concordant();
