-- Liste initiale de domaines de presse. Éditable ensuite depuis l'admin.
insert into public.trusted_domains (domain, label, kind) values
  ('lemonde.fr', 'Le Monde', 'presse'),
  ('liberation.fr', 'Libération', 'presse'),
  ('lefigaro.fr', 'Le Figaro', 'presse'),
  ('leparisien.fr', 'Le Parisien', 'presse'),
  ('francetvinfo.fr', 'Franceinfo', 'presse'),
  ('20minutes.fr', '20 Minutes', 'presse'),
  ('ouest-france.fr', 'Ouest-France', 'presse'),
  ('letelegramme.fr', 'Le Télégramme', 'presse'),
  ('sudouest.fr', 'Sud Ouest', 'presse'),
  ('ladepeche.fr', 'La Dépêche', 'presse'),
  ('laprovence.com', 'La Provence', 'presse'),
  ('ledauphine.com', 'Le Dauphiné libéré', 'presse'),
  ('lavoixdunord.fr', 'La Voix du Nord', 'presse'),
  ('leprogres.fr', 'Le Progrès', 'presse'),
  ('estrepublicain.fr', 'L''Est Républicain', 'presse'),
  ('dna.fr', 'Dernières Nouvelles d''Alsace', 'presse'),
  ('midilibre.fr', 'Midi Libre', 'presse'),
  ('nicematin.com', 'Nice-Matin', 'presse'),
  ('actu.fr', 'Actu.fr', 'presse'),
  ('bfmtv.com', 'BFM TV', 'presse'),
  ('radiofrance.fr', 'Radio France', 'presse')
on conflict (domain) do nothing;
