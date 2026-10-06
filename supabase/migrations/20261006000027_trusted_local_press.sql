-- Presse locale et régionale ajoutée aux préréglages (flux RSS vérifiés le 2026-10-06).
insert into public.trusted_domains (domain, label, kind) values
  ('francebleu.fr', 'ici (ex-France Bleu)', 'presse'),
  ('ici.fr', 'ici (ex-France Bleu)', 'presse'),
  ('centrepresseaveyron.fr', 'Centre Presse Aveyron', 'presse'),
  ('petitbleu.fr', 'Le Petit Bleu', 'presse'),
  ('nrpyrenees.fr', 'La Nouvelle République des Pyrénées', 'presse'),
  ('corsenetinfos.corsica', 'Corse Net Infos', 'presse'),
  ('lyoncapitale.fr', 'Lyon Capitale', 'presse'),
  ('lyonmag.com', 'LyonMag', 'presse'),
  ('clicanoo.re', 'Clicanoo', 'presse'),
  ('lejournaldemayotte.yt', 'Le Journal de Mayotte', 'presse')
on conflict (domain) do nothing;
