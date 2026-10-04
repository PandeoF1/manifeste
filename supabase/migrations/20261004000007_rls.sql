alter table public.app_settings enable row level security;
alter table public.schools enable row level security;
alter table public.trusted_domains enable row level security;
alter table public.scrape_sources enable row level security;
alter table public.reports enable row level security;
alter table public.scraped_items enable row level security;
alter table public.unmatched_extractions enable row level security;

-- Lecture publique.
create policy "lecture publique" on public.app_settings for select using (true);
create policy "lecture publique" on public.schools for select using (true);
create policy "lecture publique" on public.trusted_domains for select using (true);
create policy "lecture publique des reports validés" on public.reports
  for select using (moderation = 'validated');

-- Admin.
create policy "admin lit tout" on public.reports for select to authenticated using (public.is_admin());
create policy "admin modère" on public.reports for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "admin gère" on public.trusted_domains for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "admin gère" on public.scrape_sources for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "admin lit" on public.unmatched_extractions for select to authenticated using (public.is_admin());
create policy "admin supprime" on public.unmatched_extractions for delete to authenticated using (public.is_admin());

-- Aucune écriture publique : les insertions de reports passent par les Edge Functions (service role).
revoke insert, update, delete on public.reports from anon, authenticated;
grant update (moderation) on public.reports to authenticated;
revoke all on public.scraped_items from anon, authenticated;
revoke insert, update, delete on public.schools, public.app_settings from anon, authenticated;
revoke all on public.unmatched_extractions from anon;
revoke insert, update on public.unmatched_extractions from authenticated;
revoke all on public.scrape_sources from anon;
revoke insert, update, delete on public.trusted_domains from anon;
revoke execute on function public.match_school(text, text, int) from anon, authenticated, public;

-- Realtime : les clients écoutent les reports (RLS appliquée : validés seulement pour le public).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.reports;
  end if;
end
$$;
