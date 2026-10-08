-- Petits réglages de performance et de lisibilité des statistiques.

-- 1. Index sur les clés étrangères vers scrape_sources (suppression d'une source, jointures).
create index if not exists media_analyses_source_id_idx on public.media_analyses (source_id);
create index if not exists unmatched_extractions_source_id_idx on public.unmatched_extractions (source_id);

-- 2. Courbes de performance : pas de p75 pour un créneau qui compte moins de 3 mesures
--    (une seule visite lente suffisait à faire grimper la courbe). La fonction est
--    modifiée en place pour garder ses gardes d'accès (admin / modérateur).
do $$
declare
  def text;
  patched text;
  m text;
begin
  def := pg_get_functiondef('public.admin_analytics_series(text)'::regprocedure);
  patched := def;
  foreach m in array array['LCP', 'INP', 'API'] loop
    patched := replace(
      patched,
      format('percentile_cont(0.75) within group (order by a.value) filter (where a.metric = %L) as', m),
      format('case when count(*) filter (where a.metric = %L) >= 3 then '
             || 'percentile_cont(0.75) within group (order by a.value) filter (where a.metric = %L) end as', m, m));
    if patched = def or position(format('where a.metric = %L) >= 3', m) in patched) = 0 then
      raise exception 'admin_analytics_series : percentile % introuvable', m;
    end if;
  end loop;
  execute patched;
end
$$;
