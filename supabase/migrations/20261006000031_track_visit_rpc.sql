-- Statistiques : envoi direct à la base (PostgREST) au lieu de l'Edge Function « beacon »,
-- pour ne plus consommer d'appels de fonction. L'IP est lue dans les en-têtes de la requête
-- (posés par la passerelle Supabase), uniquement pour l'empreinte du jour : jamais stockée.

/** IP du visiteur d'après les en-têtes de la requête PostgREST (vide hors requête HTTP). */
create or replace function public.request_ip()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(h->>'cf-connecting-ip', ''),
    nullif(h->>'x-real-ip', ''),
    nullif(trim(split_part(h->>'x-forwarded-for', ',', 1)), ''),
    ''
  )
  from (select coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json as h) r
$$;
revoke execute on function public.request_ip() from public, anon, authenticated;

/** Page vue et/ou mesures, depuis le navigateur. Robots ignorés. */
create or replace function public.track_visit(
  p_page text,
  p_view boolean default true,
  p_metrics jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ua text := coalesce(
    (coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json)->>'user-agent', '');
begin
  if v_ua ~* '(bot|crawl|spider|slurp|preview|headless|lighthouse|pagespeed|curl|wget)' then
    return;
  end if;
  if octet_length(coalesce(p_metrics, '[]'::jsonb)::text) > 2048 then
    return;
  end if;
  perform public.record_beacon(public.request_ip(), p_page, coalesce(p_view, false), coalesce(p_metrics, '[]'::jsonb));
end;
$$;
revoke execute on function public.track_visit(text, boolean, jsonb) from public;
grant execute on function public.track_visit(text, boolean, jsonb) to anon, authenticated;
