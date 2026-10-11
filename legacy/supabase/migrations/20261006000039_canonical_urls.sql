-- Un même article reçu par deux flux (ex. ici.fr en RSS avec ?at_medium=lien_RSS et via Google
-- Actualités) avait deux adresses : il était compté et listé en double. Adresse canonique : sans
-- fragment, sans paramètres de suivi ni « / » final (même règle que canonicalUrl en TypeScript).
create or replace function public.canonical_url(p_url text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(
    regexp_replace(
      regexp_replace(
        -- une éventuelle « & » devenue première séparation redevient « ? »
        regexp_replace(
          regexp_replace(
            split_part(p_url, '#', 1),
            '[?&](utm_[^&=]*|at_[^&=]*|fbclid|gclid|msclkid|xtor|xtref|cmpid|ito|mc_cid|mc_eid|igshid)=[^&]*',
            '', 'gi'),
          '^([^?]*)&', '\1?'),
        '\?$', ''),
      '/\?', '?'),
    '/$', '')
$$;

-- Doublons : on garde le plus ancien de chaque (adresse canonique, lycée, statut).
delete from public.reports r
using (
  select id, row_number() over (
    partition by public.canonical_url(source_url), school_uai, status order by created_at, id) rn
  from public.reports
  where source_url is not null and source_type <> 'utilisateur'
) d
where r.id = d.id and d.rn > 1;

update public.reports set source_url = public.canonical_url(source_url)
where source_url is not null and source_type <> 'utilisateur'
  and source_url <> public.canonical_url(source_url);

update public.unmatched_extractions set source_url = public.canonical_url(source_url)
where source_url <> public.canonical_url(source_url);

delete from public.media_analyses m
using (
  select id, row_number() over (partition by public.canonical_url(url) order by analyzed_at, id) rn
  from public.media_analyses
) d
where m.id = d.id and d.rn > 1;
update public.media_analyses set url = public.canonical_url(url) where url <> public.canonical_url(url);
