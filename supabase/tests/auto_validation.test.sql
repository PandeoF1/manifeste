-- Tests de la règle de validation automatique et de l'expiration.
begin;

insert into public.scrape_sources (id, kind, identifier, label, trusted)
values ('00000000-0000-0000-0000-00000000000a', 'telegram', 'canal_confiance', 'Canal de confiance', true),
       ('00000000-0000-0000-0000-00000000000b', 'telegram', 'canal_a', 'Canal A', false),
       ('00000000-0000-0000-0000-00000000000c', 'telegram', 'canal_b', 'Canal B', false);

create temp table t (name text, ok boolean);
grant all on t to anon;

-- 1. Domaine de confiance -> validated
insert into public.reports (school_uai, status, source_type, source_url, source_domain, observed_at)
values ('0000001A', 'bloque', 'presse', 'https://www.lemonde.fr/a', 'lemonde.fr', now());
insert into t select 'domaine de confiance', moderation = 'validated' from public.reports where source_url = 'https://www.lemonde.fr/a';

-- 2. Source collectée de confiance -> validated
insert into public.reports (school_uai, status, source_type, source_url, source_domain, source_id, observed_at)
values ('0000002B', 'filtrant', 'collecteur', 'https://t.me/canal_confiance/1', 't.me', '00000000-0000-0000-0000-00000000000a', now());
insert into t select 'source de confiance', moderation = 'validated' from public.reports where source_url = 'https://t.me/canal_confiance/1';

-- 3. Source seule non fiable -> pending
insert into public.reports (school_uai, status, source_type, source_url, source_domain, source_id, observed_at)
values ('0000003C', 'bloque', 'collecteur', 'https://t.me/canal_a/1', 't.me', '00000000-0000-0000-0000-00000000000b', now() - interval '30 minutes');
insert into t select 'seule -> pending', moderation = 'pending' from public.reports where source_url = 'https://t.me/canal_a/1';

-- 4. Même source, même domaine : pas de concordance
insert into public.reports (school_uai, status, source_type, source_url, source_domain, source_id, observed_at)
values ('0000003C', 'bloque', 'collecteur', 'https://t.me/canal_a/2', 't.me', '00000000-0000-0000-0000-00000000000b', now());
insert into t select 'même source -> pending', moderation = 'pending' from public.reports where source_url = 'https://t.me/canal_a/2';

-- 5. Autre source (même domaine t.me, autre canal) concordante -> validated, et les précédents promus
insert into public.reports (school_uai, status, source_type, source_url, source_domain, source_id, observed_at)
values ('0000003C', 'bloque', 'collecteur', 'https://t.me/canal_b/9', 't.me', '00000000-0000-0000-0000-00000000000c', now());
insert into t select 'concordance -> validated', moderation = 'validated' from public.reports where source_url = 'https://t.me/canal_b/9';
insert into t select 'concordance -> promotion', bool_and(moderation = 'validated') from public.reports where school_uai = '0000003C';

-- 6. Statut différent : pas de concordance
insert into public.reports (school_uai, status, source_type, source_url, source_domain, observed_at)
values ('0000004D', 'bloque', 'collecteur', 'https://exemple-a.fr/x', 'exemple-a.fr', now());
insert into public.reports (school_uai, status, source_type, source_url, source_domain, observed_at)
values ('0000004D', 'filtrant', 'collecteur', 'https://exemple-b.fr/x', 'exemple-b.fr', now());
insert into t select 'statut différent -> pending', bool_and(moderation = 'pending') from public.reports where school_uai = '0000004D';

-- 7. Hors fenêtre de 2 h : pas de concordance
insert into public.reports (school_uai, status, source_type, source_url, source_domain, observed_at)
values ('0000005E', 'bloque', 'collecteur', 'https://exemple-a.fr/y', 'exemple-a.fr', now() - interval '3 hours');
insert into public.reports (school_uai, status, source_type, source_url, source_domain, observed_at)
values ('0000005E', 'bloque', 'collecteur', 'https://exemple-b.fr/y', 'exemple-b.fr', now());
insert into t select 'hors fenêtre -> pending', bool_and(moderation = 'pending') from public.reports where school_uai = '0000005E';

-- 8. Deux signalements utilisateur ne se valident pas entre eux
insert into public.reports (school_uai, status, source_type, source_url, source_domain, observed_at)
values ('0000004D', 'leve', 'utilisateur', 'https://exemple-c.fr/z', 'exemple-c.fr', now());
insert into public.reports (school_uai, status, source_type, source_url, source_domain, observed_at)
values ('0000004D', 'leve', 'utilisateur', 'https://exemple-d.fr/z', 'exemple-d.fr', now());
insert into t select 'utilisateur x2 -> pending', bool_and(moderation = 'pending') from public.reports where school_uai = '0000004D' and status = 'leve';

-- 9. Vue : statut courant = dernier report validé
insert into public.reports (school_uai, status, source_type, source_url, source_domain, observed_at)
values ('0000001A', 'leve', 'presse', 'https://www.leparisien.fr/b', 'leparisien.fr', now() + interval '1 minute');
insert into t select 'vue : dernier statut', status = 'leve' and source_count = 2 from public.school_current_status where uai = '0000001A';
insert into t select 'vue : pending absent', not exists (select 1 from public.school_current_status where uai in ('0000004D', '0000005E'));

-- 10. Expiration : un signal validé plus vieux que le TTL sort de la vue
update public.reports set observed_at = now() - interval '6 hours' where school_uai = '0000002B';
insert into t select 'expiration TTL', not exists (select 1 from public.school_current_status where uai = '0000002B');

-- 11. Compteur national
insert into t select 'compteur national', bloque = 1 and leve = 1 from public.national_counts();

-- 12. Matching flou
insert into t select 'match homonyme Besançon', (select uai from public.match_school('lycée Victor-Hugo', 'Besancon') limit 1) = '0000002B';
insert into t select 'match Paris', (select uai from public.match_school('Victor Hugo', 'Paris') limit 1) = '0000001A';
insert into t select 'match LP Jean Moulin', (select uai from public.match_school('LP Jean-Moulin', 'Lyon 5e') limit 1) = '0000004D';

-- 13. RLS : anon ne voit que les validés et ne peut pas insérer
set local role anon;
insert into t select 'rls anon lecture', bool_and(moderation = 'validated') from public.reports;
reset role;
do $$ begin
  set local role anon;
  begin
    insert into public.reports (school_uai, status, source_type, source_url, source_domain, observed_at)
    values ('0000001A', 'bloque', 'utilisateur', 'https://x.fr', 'x.fr', now());
    raise exception 'anon a pu insérer';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.scrape_sources;
    raise exception 'anon a pu lire scrape_sources';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select name, ok from t;
do $$ declare f text; begin
  select string_agg(name, ', ') into f from t where ok is not true;
  if f is not null then raise exception 'ÉCHEC : %', f; end if;
end $$;
rollback;
