-- Extrait du texte (titre, chapeau) des extractions non rattachées : affiché au staff et
-- transmis à l'IA lors d'une réanalyse. Supprimé avec l'extraction (rattachement ou 7 jours).
alter table public.unmatched_extractions add column if not exists context text
  check (context is null or length(context) <= 1000);
