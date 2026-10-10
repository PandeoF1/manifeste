-- Domaines de confiance : un sous-domaine compte comme son domaine
-- (france3-regions.franceinfo.fr -> franceinfo.fr).
create or replace function public.is_trusted_domain(p_domain text)
returns boolean
language sql stable
set search_path = ''
as $$
  select p_domain is not null and exists (
    select 1 from public.trusted_domains d
    where p_domain = d.domain or p_domain like '%.' || d.domain
  )
$$;

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
  if new.moderation <> 'pending' or new.source_type = 'utilisateur' then
    return new;
  end if;

  if new.source_id is not null and exists (
    select 1 from public.scrape_sources s where s.id = new.source_id and s.trusted
  ) then
    new.moderation := 'validated';
    return new;
  end if;

  if public.is_trusted_domain(new.source_domain) then
    new.moderation := 'validated';
    return new;
  end if;

  if exists (
    select 1
    from public.reports r
    where r.school_uai = new.school_uai
      and r.status = new.status
      and r.moderation <> 'rejected'
      and r.source_type <> 'utilisateur'
      and abs(extract(epoch from (r.observed_at - new.observed_at))) <= extract(epoch from v_window)
      and public.report_source_key(r.source_id, r.source_domain) <> v_key
  ) then
    new.moderation := 'validated';
  end if;

  return new;
end;
$$;

-- Presse régionale vue dans les agrégateurs de la mobilisation.
insert into public.trusted_domains (domain, label, kind) values
  ('franceinfo.fr', 'franceinfo / France 3 régions', 'presse'),
  ('lamontagne.fr', 'La Montagne', 'presse'),
  ('courrier-picard.fr', 'Courrier picard', 'presse'),
  ('lunion.fr', 'L''Union', 'presse'),
  ('lindependant.fr', 'L''Indépendant', 'presse'),
  ('lejsl.com', 'Le Journal de Saône-et-Loire', 'presse'),
  ('lest-eclair.fr', 'L''Est-Éclair', 'presse'),
  ('lechorepublicain.fr', 'L''Écho républicain', 'presse'),
  ('larepubliquedespyrenees.fr', 'La République des Pyrénées', 'presse'),
  ('lanouvellerepublique.fr', 'La Nouvelle République', 'presse'),
  ('charentelibre.fr', 'Charente Libre', 'presse'),
  ('lepopulaire.fr', 'Le Populaire du Centre', 'presse'),
  ('ladepeche.fr', 'La Dépêche', 'presse'),
  ('vosgesmatin.fr', 'Vosges Matin', 'presse'),
  ('republicain-lorrain.fr', 'Le Républicain lorrain', 'presse'),
  ('ledauphine.com', 'Le Dauphiné libéré', 'presse'),
  ('lavoixdunord.fr', 'La Voix du Nord', 'presse'),
  ('nordlittoral.fr', 'Nord Littoral', 'presse'),
  ('paris-normandie.fr', 'Paris-Normandie', 'presse'),
  ('lamanchelibre.fr', 'La Manche libre', 'presse')
on conflict (domain) do nothing;
