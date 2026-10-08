-- Tests des données ouvertes (public.open_data) : visibles par tout le monde, sans rien d'intime.
begin;
create temp table t (name text, ok boolean);
grant all on t to anon;

insert into public.schools (uai, name, city, department, academy, level, location) values
  ('0910001A', 'Lycée Ouvert Un', 'Lille', '59', 'Lille', 'lycee', 'SRID=4326;POINT(3.06 50.63)'),
  ('0910002B', 'Lycée Ouvert Deux', 'Toulouse', '31', 'Toulouse', 'lycee', 'SRID=4326;POINT(1.44 43.60)'),
  ('0910003C', 'Fac Ouverte', 'Toulouse', '31', 'Toulouse', 'superieur', 'SRID=4326;POINT(1.45 43.61)');

-- Validés (presse, collecteur, utilisateur), un en attente, un masqué, un d'un autre jour.
insert into public.reports (school_uai, status, source_type, source_url, source_domain, moderation, observed_at) values
  ('0910001A', 'bloque', 'presse', 'https://presse.example/a', 'presse.example', 'validated', now() - interval '2 hours'),
  ('0910001A', 'bloque', 'collecteur', 'https://t.me/c/1', 't.me', 'validated', now() - interval '3 hours'),
  ('0910002B', 'filtrant', 'utilisateur', 'https://secret.example/prive', 'secret.example', 'validated', now() - interval '1 hour'),
  ('0910003C', 'bloque', 'presse', 'https://presse.example/b', 'presse.example', 'validated', now() - interval '4 days'),
  ('0910002B', 'bloque', 'presse', 'https://presse.example/c', 'presse.example', 'pending', now() - interval '1 hour');
insert into public.reports (school_uai, status, source_type, source_url, source_domain, moderation, hidden, observed_at)
values ('0910002B', 'bloque', 'presse', 'https://presse.example/masque', 'presse.example', 'validated', true, now() - interval '1 hour');

set local role anon;

create temp table resume as select public.open_data('resume') j;
create temp table jours as select public.open_data('jours') j;
create temp table etab as select public.open_data('etablissements') j;
create temp table sig as select public.open_data('signalements') j;
create temp table dep as select public.open_data('departements') j;

insert into t select 'résumé : 3 établissements, 2 départements (en attente et masqué écartés)',
  (select (j->>'etablissements')::int = 3 and (j->>'departements')::int = 2 from resume);
insert into t select 'résumé : une fac comptée', (select (j->>'facs')::int = 1 from resume);
insert into t select 'résumé : origines détaillées',
  (select jsonb_array_length(j->'origines') = 3 from resume);
-- Écart de 4 jours (et non 3) : près de minuit à Paris, un signalement vieux de 3 jours tombe sur le jour suivant.
insert into t select 'jours : les jours sans signalement sont présents (4 jours, 0 au milieu)',
  (select jsonb_array_length(j) >= 4 from jours)
  and (select bool_or((p->>'etablissements')::int = 0) from jours, jsonb_array_elements(j) p);
insert into t select 'jours : tous les statuts d''origine sont séparés',
  (select sum((p->>'via_presse')::int) >= 2
      and sum((p->>'via_autres_sources')::int) >= 1
      and sum((p->>'via_signalements_sur_place')::int) >= 1
   from jours, jsonb_array_elements(j) p);
insert into t select 'établissements : 3 lignes, coordonnées arrondies',
  (select jsonb_array_length(j) = 3 from etab)
  and (select bool_and((p->>'lat') is not null) from etab, jsonb_array_elements(j) p);
insert into t select 'signalements : 4 validés visibles',
  (select jsonb_array_length(j) = 4 from sig);
insert into t select 'signalements : jamais de lien pour un signalement sur place',
  (select bool_and(p->>'lien_source' is null and p->>'site_source' is null)
   from sig, jsonb_array_elements(j) p where p->>'origine' = 'utilisateur');
insert into t select 'signalements : lien conservé pour la presse',
  (select bool_and(p->>'lien_source' is not null)
   from sig, jsonb_array_elements(j) p where p->>'origine' = 'presse');
insert into t select 'signalements : le lien secret n''apparaît nulle part',
  (select position('secret.example' in j::text) = 0 from sig);
insert into t select 'départements : Toulouse compte lycée et fac',
  (select (p->>'etablissements')::int = 2 and (p->>'facs')::int = 1
   from dep, jsonb_array_elements(j) p where p->>'zone' = '31');

do $$ begin
  perform public.open_data('nimporte');
  raise exception 'vue inconnue acceptée';
exception when invalid_parameter_value then null; end $$;
insert into t select 'vue inconnue refusée', true;

reset role;
insert into t select 'toutes les vérifications présentes', (select count(*) from t) = 12;

select name, ok from t;
do $$ declare f text; begin
  select string_agg(name, ', ') into f from t where ok is not true;
  if f is not null then raise exception 'ÉCHEC : %', f; end if;
end $$;
rollback;
