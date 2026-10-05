-- Le bouton Valider / Rejeter de l'admin : update { moderation, photo_public_path }.
begin;
create temp table t (name text, ok boolean);
grant all on t to authenticated;

insert into public.reports (id, school_uai, status, source_type, source_url, source_domain, observed_at)
values ('00000000-0000-0000-0000-0000000000e1', '0000003C', 'bloque', 'collecteur', 'https://news.google.com/x', 'news.google.com', now());

set local role authenticated;
select set_config('request.jwt.claims', '{"app_metadata":{"role":"admin"}}', true);
update public.reports set moderation = 'validated', photo_public_path = null
where id = '00000000-0000-0000-0000-0000000000e1';
reset role;
insert into t select 'admin valide (moderation + photo)', moderation = 'validated'
  from public.reports where id = '00000000-0000-0000-0000-0000000000e1';

-- Un compte non admin ne modifie rien (RLS), et ne peut toucher aucune autre colonne.
set local role authenticated;
select set_config('request.jwt.claims', '{"app_metadata":{"role":"user"}}', true);
update public.reports set moderation = 'rejected' where id = '00000000-0000-0000-0000-0000000000e1';
reset role;
insert into t select 'non-admin sans effet', moderation = 'validated'
  from public.reports where id = '00000000-0000-0000-0000-0000000000e1';
do $$ begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"app_metadata":{"role":"admin"}}', true);
  begin
    update public.reports set school_uai = '0000001A' where id = '00000000-0000-0000-0000-0000000000e1';
    raise exception 'colonne school_uai modifiable';
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
