-- 1. Nouveau type de source : carte Google My Maps publique (export KML).
alter type public.scrape_kind add value if not exists 'mymaps';
