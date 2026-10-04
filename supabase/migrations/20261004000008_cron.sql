-- Planification de la collecte toutes les 10 minutes (pg_cron + pg_net).
-- L'URL de la fonction et le secret sont lus dans Supabase Vault :
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/collect', 'collect_url');
--   select vault.create_secret('<COLLECT_SECRET>', 'collect_secret');
-- Ignoré si les extensions ne sont pas disponibles (Postgres local de test).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net with schema extensions;

    perform cron.schedule(
      'collect-sources',
      '*/10 * * * *',
      $cron$
        select net.http_post(
          url := (select decrypted_secret from vault.decrypted_secrets where name = 'collect_url'),
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-collect-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'collect_secret')
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 140000
        )
      $cron$
    );

    -- Purge des traces de déduplication et des extractions non rattachées après 7 jours.
    perform cron.schedule(
      'purge-collector-traces',
      '17 3 * * *',
      $cron$
        delete from public.scraped_items where processed_at < now() - interval '7 days';
        delete from public.unmatched_extractions where created_at < now() - interval '7 days';
      $cron$
    );
  end if;
end
$$;
