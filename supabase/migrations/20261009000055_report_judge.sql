-- Juge (Jev, TypeSafe AI) : second avis enregistré sur chaque signalement de presse lisible.
--   judge_score  : probabilité (0 à 1) que le texte dise que l'établissement est bloqué ou fermé ;
--   judge_nature : blocage, ferme, rassemblement, incident ou autre ;
--   judge_level  : lycee, superieur ou inconnu (recoupe le niveau de l'établissement) ;
--   judge_model  : version exacte qui a répondu (les seuils dépendent de la version) ;
--   judged_at    : quand ; judge_chars : taille du texte envoyé.
-- Mode observation : rien dans l'affichage ni dans les statistiques ne lit encore ces colonnes.
alter table public.reports
  add column judge_score real check (judge_score is null or judge_score between 0 and 1),
  add column judge_nature text check (
    judge_nature is null or judge_nature in ('blocage', 'ferme', 'rassemblement', 'incident', 'autre')
  ),
  add column judge_level text check (
    judge_level is null or judge_level in ('lycee', 'superieur', 'inconnu')
  ),
  add column judge_model text,
  add column judged_at timestamptz,
  add column judge_chars integer;

comment on column public.reports.judge_score is
  'Probabilité (juge Jev) que le texte soutienne « bloqué ou fermé » ; null = pas jugé (texte trop court, panne).';
