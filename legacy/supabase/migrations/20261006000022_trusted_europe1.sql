-- Europe 1 rejoint les médias reconnus (flux RSS direct ajouté aux préréglages).
insert into public.trusted_domains (domain, label, kind) values
  ('europe1.fr', 'Europe 1', 'presse')
on conflict (domain) do nothing;
