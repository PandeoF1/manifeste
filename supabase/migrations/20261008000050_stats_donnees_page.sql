-- Statistiques : la page « Données » a son propre nom au lieu de tomber dans « Autre ».
-- Les visites passées restent classées « Autre » (la page exacte n'a jamais été conservée).

-- 1. Les trois tables acceptent la nouvelle valeur.
do $$
declare
  t text;
  c record;
begin
  foreach t in array array['analytics_pageviews', 'analytics_vitals', 'analytics_live'] loop
    for c in
      select con.conname
      from pg_constraint con
      where con.conrelid = format('public.%I', t)::regclass
        and con.contype = 'c'
        and pg_get_constraintdef(con.oid) like '%a-propos%'
    loop
      execute format('alter table public.%I drop constraint %I', t, c.conname);
    end loop;
    execute format(
      'alter table public.%I add constraint %I check (page in (''carte'', ''liste'', ''lycee'', ''signaler'', ''a-propos'', ''donnees'', ''autre''))',
      t, t || '_page_check');
  end loop;
end
$$;

-- 2. Les fonctions qui rangent la page reconnaissent « donnees » (corps patché en place).
do $$
declare
  r record;
  patched integer := 0;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosrc like '%''signaler'', ''a-propos'') then p_page%'
  loop
    execute replace(
      pg_get_functiondef(r.oid),
      '''signaler'', ''a-propos'') then p_page',
      '''signaler'', ''a-propos'', ''donnees'') then p_page');
    patched := patched + 1;
  end loop;
  if patched < 2 then
    raise exception 'fonctions de classement des pages introuvables (% trouvée(s))', patched;
  end if;
end
$$;
