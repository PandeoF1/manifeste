begin;
create temp table t (name text, ok boolean);
insert into t select 'suivi retiré', public.canonical_url('https://www.ici.fr/a/b-8218869?at_medium=lien_RSS&at_locale=56') = 'https://www.ici.fr/a/b-8218869';
insert into t select 'fragment et / final', public.canonical_url('https://www.ici.fr/a/b/?utm_source=x#haut') = 'https://www.ici.fr/a/b';
insert into t select 'paramètre utile gardé', public.canonical_url('https://exemple.fr/a?id=12&utm_medium=rss') = 'https://exemple.fr/a?id=12';
insert into t select 'suivi en tête, utile après', public.canonical_url('https://exemple.fr/a?fbclid=z&id=12') = 'https://exemple.fr/a?id=12';
insert into t select 'adresse propre inchangée', public.canonical_url('https://exemple.fr/a/b') = 'https://exemple.fr/a/b';
insert into t select 'toutes les vérifications présentes', (select count(*) from t) = 5;
select name, ok from t;
do $$ declare f text; begin
  select string_agg(name, ', ') into f from t where ok is not true;
  if f is not null then raise exception 'ÉCHEC : %', f; end if;
end $$;
rollback;
