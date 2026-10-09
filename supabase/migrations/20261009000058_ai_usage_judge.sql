-- Coût IA : le juge Jev a sa propre tâche (appels et tokens envoyés, estimés à ~4 caractères par token).
alter table public.ai_usage drop constraint if exists ai_usage_task_check;
alter table public.ai_usage
  add constraint ai_usage_task_check check (task in ('extraction', 'media', 'reanalyse', 'backfill', 'judge'));
