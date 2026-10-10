-- Text normalisation used by school search and matching, mirrored in @manifeste/core
-- (stripGenericWords). IMMUTABLE so they can back generated columns and indexes.

-- Lowercase, no accents, only letters and digits separated by single spaces.
CREATE OR REPLACE FUNCTION normalize_text(p text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$
    SELECT trim(regexp_replace(lower(public.immutable_unaccent(coalesce(p, ''))), '[^a-z0-9]+', ' ', 'g'))
  $$;
--> statement-breakpoint
-- A school name without the generic words ("Lycée professionnel Jean-Moulin" -> "jean moulin").
CREATE OR REPLACE FUNCTION strip_generic_words(p text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$
    SELECT trim(regexp_replace(
      regexp_replace(
        public.normalize_text(p),
        '\m(lycee|lycees|lp|lgt|lpo|general|generale|polyvalent|professionnel|technologique|public|prive|universite|universites|fac|faculte|iut|ufr|campus|site|des|du|de|la|le|les|l|d|et|a)\M',
        ' ', 'g'),
      '\s+', ' ', 'g'))
  $$;
