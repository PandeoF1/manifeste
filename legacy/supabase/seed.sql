-- Données de démonstration pour le développement local uniquement.
-- Les UAI commençant par 000000 sont fictifs. En production, lancer scripts/import-schools.ts.
insert into public.schools (uai, name, city, postcode, department, academy, location, kind) values
  ('0000001A', 'Lycée Victor Hugo', 'Paris', '75003', '75', 'Paris', 'SRID=4326;POINT(2.3622 48.8590)', 'général'),
  ('0000002B', 'Lycée Victor Hugo', 'Besançon', '25000', '25', 'Besançon', 'SRID=4326;POINT(6.0240 47.2380)', 'général'),
  ('0000003C', 'Lycée Jean Jaurès', 'Montreuil', '93100', '93', 'Créteil', 'SRID=4326;POINT(2.4410 48.8620)', 'polyvalent'),
  ('0000004D', 'Lycée professionnel Jean Moulin', 'Lyon', '69005', '69', 'Lyon', 'SRID=4326;POINT(4.8270 45.7600)', 'pro'),
  ('0000005E', 'Lycée Pierre Mendès France', 'Rennes', '35000', '35', 'Rennes', 'SRID=4326;POINT(-1.6550 48.1170)', 'polyvalent')
on conflict (uai) do nothing;
