-- Names the press uses for a school or a part of it, that the directory does not carry.
-- Matching compares a citation with `schools.aliases` after dropping generic words, so "Le Patio"
-- and "patio" are the same alias. Idempotent: run it as often as needed.
--
--   psql "$DATABASE_URL" -f packages/db/seeds/school-aliases.sql

with seed(uai, alias) as (values
  -- Grandes écoles whose directory record has a longer official name
  ('0783054W', 'HEC'),
  ('0783054W', 'HEC Paris'),
  ('0912403T', 'Télécom Paris'),
  ('0912403T', 'Ensae'),
  ('0590344D', 'ESPOL'),
  ('0690192J', 'INSA'),
  ('0690192J', 'INSA Lyon'),
  ('0690173N', 'IEP'),
  ('0690173N', 'IEP Lyon'),
  -- Parts of a university, known by the name of their building or campus
  ('0720916E', 'ENSIM'),
  ('0720916E', 'École nationale supérieure d''ingénieurs du Mans'),
  ('0673021V', 'Le Patio'),
  ('0673021V', 'Le Portique'),
  ('0673021V', 'Le Cardo'),
  ('0673021V', 'L''Escarpe'),
  ('0371610Z', 'Deux Lions'),
  ('0371610Z', 'Tanneurs'),
  ('0692437Z', 'Manufacture des Tabacs')
)
update schools s
set aliases = (
  select array_agg(distinct a order by a)
  from unnest(s.aliases || array(select alias from seed where seed.uai = s.uai)) as a
)
where s.uai in (select uai from seed);
