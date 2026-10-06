-- Secret de collecte lu par les Edge Functions directement dans le Vault (une seule source :
-- le même secret que celui envoyé par pg_cron), réservé au rôle service.
create or replace function public.collect_secret()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return (select decrypted_secret from vault.decrypted_secrets where name = 'collect_secret' limit 1);
end;
$$;

revoke all on function public.collect_secret() from public, anon, authenticated;
grant execute on function public.collect_secret() to service_role;
