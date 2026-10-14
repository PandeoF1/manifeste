-- Longueur du texte lu par l'IA (titre + chapeau) : un article dont l'IA n'a vu que le titre ne
-- peut pas servir à mesurer « les revendications sont-elles exposées ? ». Null = ancienne analyse.
alter table public.media_analyses add column text_chars integer;
