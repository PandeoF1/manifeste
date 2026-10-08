-- Tests de l'historique de la carte (public.timeline_events) : lisible par tous, sans rien d'intime.
begin;
create temp table t (name text, ok boolean);
grant all on t to anon;

insert into public.schools (uai, name, city, department, academy, level, location) values
  ('0920001A', 'Lycée Frise Un', 'Lille', '59', 'Lille', 'lycee', 'SRID=4326;POINT(3.06 50.63)'),
  ('0920002B', 'Lycée Frise Deux', 'Toulouse', '31', 'Toulouse', 'lycee', 'SRID=4326;POINT(1.44 43.60)'),
  ('0920003C', 'Lycée Sans Signal', 'Nice', '06', 'Nice', 'lycee', 'SRID=4326;POINT(7.26 43.70)');

insert into public.reports (school_uai, status, source_type, source_url, source_domain, moderation, observed_at) values
  ('0920001A', 'bloque', 'presse', 'https://presse.example/a', 'presse.example', 'validated', now() - interval '6 hours'),
  ('0920001A', 'leve', 'presse', 'https://presse.example/b', 'presse.example', 'validated', now() - interval '2 hours'),
  ('0920002B', 'filtrant', 'utilisateur', 'https://secret.example/prive', 'secret.example', 'validated', now() - interval '4 hours'),
  ('0920002B', 'bloque', 'presse', 'https://presse.example/c', 'presse.example', 'pending', now() - interval '1 hour'),
  ('0920002B', 'bloque', 'presse', 'https://presse.example/ancien', 'presse.example', 'validated', now() - interval '3 days');
insert into public.reports (school_uai, status, source_type, source_url, source_domain, moderation, hidden, observed_at)
values ('0920002B', 'bloque', 'presse', 'https://presse.example/masque', 'presse.example', 'validated', true, now() - interval '1 hour');

set local role anon;

create temp table tl as select public.timeline_events(now() - interval '1 day') j;
create temp table tl_all as select public.timeline_events(now() - interval '10 days') j;

insert into t select 'événements : 3 validés et visibles sur 24 h (attente, masqué et ancien écartés)',
  (select jsonb_array_length(j->'events') = 3 from tl);
insert into t select 'événements : 4 sur 10 jours (l''ancien validé revient)',
  (select jsonb_array_length(j->'events') = 4 from tl_all);
insert into t select 'événements : du plus ancien au plus récent',
  (select (j->'events'->0->>'t')::bigint < (j->'events'->1->>'t')::bigint
      and (j->'events'->1->>'t')::bigint < (j->'events'->2->>'t')::bigint from tl);
insert into t select 'établissements : seulement ceux qui ont un signalement',
  (select jsonb_array_length(j->'schools') = 2 from tl)
  and (select position('0920003C' in j::text) = 0 from tl);
insert into t select 'établissements : coordonnées présentes',
  (select bool_and((p->>'lat') is not null and (p->>'lng') is not null)
   from tl, jsonb_array_elements(j->'schools') p);
insert into t select 'rien d''intime : aucun lien de source dans la réponse',
  (select position('secret.example/prive' in j::text) = 0 and position('presse.example/a' in j::text) = 0 from tl);
insert into t select 'statuts : bloqué, filtrant et levé conservés',
  (select count(distinct e->>'s') = 3 from tl, jsonb_array_elements(j->'events') e);
insert into t select 'heure en millisecondes',
  (select (j->'events'->0->>'t')::bigint > 1000000000000 from tl);

reset role;
insert into t select 'toutes les vérifications présentes', (select count(*) from t) = 8;

select name, ok from t;
do $$ declare f text; begin
  select string_agg(name, ', ') into f from t where ok is not true;
  if f is not null then raise exception 'ÉCHEC : %', f; end if;
end $$;
rollback;
