-- Traçabilité des dates d'un signalement : date de publication de l'article, date brute donnée par
-- l'IA et origine de la date retenue. Sans elles, impossible de savoir après coup si un signalement
-- daté du dimanche vient d'un fait du dimanche ou d'un article publié ce jour-là.
alter table public.reports
  add column if not exists published_at timestamptz,
  add column if not exists extracted_observed_at text,
  add column if not exists date_basis text
    check (date_basis in ('extracted', 'announced', 'published'));

comment on column public.reports.published_at is 'Publication de l''article source (collecteur).';
comment on column public.reports.extracted_observed_at is 'Date du fait telle que donnée par l''IA, avant validation.';
comment on column public.reports.date_basis is
  'Origine de observed_at : extracted (date de l''IA), announced (jour annoncé à venir), published (repli sur la publication).';
