-- Presse nationale et régionale ajoutée aux préréglages de flux RSS directs.
insert into public.trusted_domains (domain, label, kind) values
  ('lejdd.fr', 'Le JDD', 'presse'),
  ('lexpress.fr', 'L''Express', 'presse'),
  ('rfi.fr', 'RFI', 'presse'),
  ('mediapart.fr', 'Mediapart', 'presse'),
  ('humanite.fr', 'L''Humanité', 'presse'),
  ('lalsace.fr', 'L''Alsace', 'presse'),
  ('bienpublic.com', 'Le Bien public', 'presse')
on conflict (domain) do nothing;
