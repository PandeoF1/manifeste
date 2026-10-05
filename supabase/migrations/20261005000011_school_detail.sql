-- Fiche lycée : informations publiques et coordonnées (la colonne geography n'est pas lisible
-- directement par le client).
create or replace function public.school_detail(p_uai text)
returns table (
  uai text, name text, city text, postcode text, department text, academy text, kind text,
  lat double precision, lng double precision
)
language sql stable
security invoker
set search_path = ''
as $$
  select s.uai, s.name, s.city, s.postcode, s.department, s.academy, s.kind,
         extensions.st_y(s.location::extensions.geometry), extensions.st_x(s.location::extensions.geometry)
  from public.schools s
  where s.uai = p_uai
$$;
