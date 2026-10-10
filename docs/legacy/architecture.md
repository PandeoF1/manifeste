# Architecture and operations (legacy Supabase stack)

> **Legacy.** This describes the collection pipeline and operations of the Supabase + Vercel stack,
> which still runs production until the v2 cutover. The v2 architecture is in
> [ADR 0001](../adr/0001-v2-architecture.md); setting up a development machine is in
> [docs/development.md](../development.md). Overview in English: [README](../../README.md).

Detailed notes: collection, on-site reports, directory imports, sources, tests. The step-by-step
deployment guide is in [deployment.md](deployment.md).

## How the collection works

```
pg_cron (every 10 min)
  └─> Edge Function `collect` (dispatcher): up to 80 sources, the least recent first,
      split into groups of 4, one `collect` sub-call per group (4 in parallel);
      each sub-call has its own budget (2 s CPU, 256 MB):
        1. fetches the latest items (t.me/s/<channel>, RSS feeds, public Bluesky API)
        2. skips those already processed (scraped_items table, purged after 7 days) and those older than 48 h
        3. keyword filter (lycée, blocus, barrage filtrant…) to limit AI calls
        4. Gemini extracts { school, city, status, date of the fact, certainty } (strict JSON schema, validated by zod),
           in batches of 20 items across all sources; 503/429 -> retry then fallback model;
           404 -> next model
        5. drops "low" certainties (calls to block, rumours, future)
        6. attaches to a UAI through public.match_school (name + city trigrams); a namesake
           without a city is never attached -> unmatched_extractions table
        7. inserts a report (source_type = the source's)
  └─> Postgres trigger: automatic validation
        - source marked "trusted" or domain in trusted_domains -> validated
        - otherwise, 2 different concordant sources (same school, same status, < 2 h) -> validated
        - otherwise pending (moderation queue in /admin)
```

No collected text is kept in the database: only the item identifier (for deduplication) and
the public link of the source are stored. The prompt forbids the model from copying names of
people, handles or descriptions.

## On-site reports (`/signaler`)

```
phone
  1. geolocation -> rounded to ~100 m on the device (the exact position never leaves it)
  2. choice of the school among those within 2 km (public.nearby_schools)
  3. status; optional photo: re-encoded through a canvas (all metadata removed),
     faces blurred by the user
  4. Cloudflare Turnstile
Edge Function submit-report
  - zod, Turnstile (without forwarding the IP), JPEG/WebP photo <= 5 MB and WITHOUT metadata
  - distance to the school <= 2 km
  - 5 submissions / day per SHA-256(IP + daily salt) fingerprint; the salt is destroyed every night
  - "user" report always pending; original photo in the private "submissions" bucket;
    rounded position + distance in report_submissions (readable by staff only)
/admin > Modération
  - staff sees the original (signed URL, 5 min), blurs it, then: publishes the blurred version
    (public "photos" bucket), validates without a photo, or rejects
  - the original is deleted in every case; purge-submissions deletes those left 48 h without a decision
```

No account, no name, no IP in clear, no photo metadata is kept.

## Map history (`/?periode=historique`)

The map's "Historique" button opens a timeline at the bottom: histogram of reports over
time, a cursor to take the map back to any moment, a play button (×1, ×2, ×4).

- **Data**: the SQL function `timeline_events(p_since)` returns in one go the schools
  concerned and all validated, non-hidden reports (identifier, status, time, source key),
  oldest to newest. Same access rules as the map (`security invoker`): no link, photo or user
  position. Loaded only in this mode, refreshed every 5 minutes.
- **Computation**: everything happens in the browser (`apps/web/src/lib/timeline.ts`). At time T, the map
  shows, for each school, the latest report of the `h` preceding hours (same rule as live,
  shifted to T). No network call while moving through time.
- **Address**: `t` (moment in milliseconds, absent = now), `h` (how long a report lasts
  in hours, absent = site setting), `r` (timeline period: `24h`, `3j`, `7j`, `tout`).
  During playback the address is only updated on pause.
- **Tests**: `legacy/supabase/tests/timeline.test.sql` (database) and `apps/web/tests/timeline.test.ts` (computations).

## Requirements

- Node 22+
- [Supabase CLI](https://supabase.com/docs/guides/local-development) (for migrations, functions, types)
- A Supabase project (PostGIS, pg_cron and pg_net are available on every plan)
- A Gemini API key (Google AI Studio)

## Installation

```bash
bun install
cp .env.example .env   # fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
bun run dev
```

## Database

```bash
cd legacy
supabase link --project-ref <ref>
supabase db push              # applies supabase/migrations
```

Then enable the scheduled collection (SQL editor):

```sql
select vault.create_secret('https://<ref>.supabase.co/functions/v1/collect', 'collect_url');
select vault.create_secret('<COLLECT_SECRET>', 'collect_secret');
select vault.create_secret('https://<ref>.supabase.co/functions/v1/purge-submissions', 'purge_url');
```

The migration `20261004000008_cron.sql` schedules the call every 10 minutes. If the extensions
were not yet enabled when `db push` ran, enable `pg_cron` and `pg_net` in the
dashboard then replay the contents of this migration.

### Admin account

No public sign-up. Create the user in the dashboard (Authentication > Users), then:

```sql
update auth.users
set raw_app_meta_data = raw_app_meta_data || '{"role": "admin"}'
where email = '<admin email>';
```

## Edge Functions

```bash
supabase secrets set GEMINI_API_KEY=... COLLECT_SECRET=$(openssl rand -hex 32) \
  GEMINI_MODEL=gemini-3.8-flash COLLECT_MIN_CERTAINTY=moyenne TURNSTILE_SECRET_KEY=...
supabase functions deploy collect --no-verify-jwt
supabase functions deploy submit-report --no-verify-jwt
supabase functions deploy purge-submissions --no-verify-jwt
```

Turnstile: create a widget in the Cloudflare dashboard, put the site key in
`VITE_TURNSTILE_SITE_KEY` (front end) and the secret key in `TURNSTILE_SECRET_KEY` (function).
Without these keys, verification is disabled (development only).

Authentication is done in the function: `x-collect-secret` header (cron) or the JWT of an
admin account ("Lancer la collecte" button in `/admin`).

## Importing the school directory

```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run import:schools
npm run import:schools -- --dry-run              # validate without writing
npm run import:schools -- --file export.json     # from a local export
```

Source: dataset `fr-en-annuaire-education` (data.education.gouv.fr), filtered on
`type_etablissement = "Lycée"` and `etat = OUVERT`. The schema is validated at runtime: if the
dataset changes, the script stops and prints the record it received.

## Adding sources

In `/admin` > Sources:

- **Telegram**: name of a **public** channel (`@channel` or `https://t.me/channel`). Read through the
  web preview `t.me/s/<channel>`, with no account or API key.
- **RSS / Atom**: any https feed. Two Google News presets ("blocus lycée",
  "lycée bloqué") cover the online press; the real publisher's domain is used for
  validation through `trusted_domains`.
- **Bluesky**: handle of an account (public API, no authentication).

Ticking "Confiance" publishes the source's signals directly. Otherwise they go through
concordance or moderation. Each source can be run by hand (play button) to test it.

## Tests

```bash
bun run test      # Vitest/bun test: parsers, extraction schema, matching, collector, domains, expiry
bun run check     # typecheck + lint + tests
```

The legacy SQL tests (`legacy/supabase/tests/run-local.sh`) replay the migrations on a throwaway
Postgres 16 (PostGIS, pg_trgm, unaccent; superuser) and check the validation rule, expiry,
matching and RLS.

## Front-end deployment

Vercel, Vite preset. Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`VITE_TURNSTILE_SITE_KEY`.
`legacy/vercel.json` handles the SPA rewrites and the security headers (CSP limited to Supabase,
OpenFreeMap and Cloudflare Turnstile).

Before going live: fill in `apps/web/src/config/legal.ts` (contact email, hosts' addresses).

## Share previews (Discord, Telegram, WhatsApp, X...)

- `api/og` (Vercel Edge) generates the 1200 x 630 image: live national figures, or the situation
  of a school with `?uai=`. Bundled Inter fonts, 5 min CDN cache.
- `api/share` serves preview robots (detected by user agent in `vercel.json`) the app's HTML
  with an adapted title, description and image. Human visitors never go through it.
- Local preview: `npx tsx scripts/preview-og.ts <folder>`.

## Logo

An exclamation mark whose bar is a sharpened pencil: to write, to speak out, to exclaim. Screen-printed poster
style, one black ink on a red background. Source: `brand/logo-mark.svg`.
`bun run --filter @manifeste/web brand` regenerates the favicon, PWA icons (192, 512, maskable),
apple-touch-icon, default share image and horizontal logo.

## PWA

Installable, works offline (last known state, kept in IndexedDB for 24 h), "new version"
banner, install prompt from the 2nd visit only.
