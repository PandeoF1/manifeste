# Manifeste

![Manifeste](brand/logo-horizontal.png)

A live map of the high schools and universities blocked in France, with a public source behind
every point. The interface is in French; the code, issues and pull requests can be in French or
English.

Live site: <https://manifeste.pandeo.fr>

## What it does

- **Live map and list** of schools and universities that are blocked or under a filtering blockade,
  with a "live" view, 24 h and 7 day summaries, and a school page for each place.
- **Automatic collection** every 10 minutes from public sources: Telegram channels, RSS/Atom feeds
  (including Google News), Bluesky accounts. Gemini extracts the school, city, status and time from
  each item as strict JSON; matching against the national school directory (UAI) is done in
  Postgres with trigram search.
- **Validation rules**: a trusted source publishes directly, otherwise two independent sources must
  agree within two hours, otherwise the report waits in a moderation queue.
- **On-site reports** from visitors: rounded geolocation, optional photo stripped of metadata and
  blurred by a staff member before publication. No account is needed.
- **Open data** at `/donnees`: daily figures, per department and academy, CSV / JSON / GeoJSON
  exports, a small HTTP API and embeddable widgets. Data is released under CC BY 4.0.
- **Admin area** for sources, moderation, unmatched items, statistics and media analysis, with a
  restricted `moderator` role that can only approve (every moderator action is logged).
- A "Your rights" page for people facing police, tear gas or custody.

## Principles

The project is informative, not partisan: no call to demonstrate, only sourced facts.

- No public accounts and no personal data about visitors.
- IP addresses are never stored in clear: rate limiting uses a hash salted with a secret that is
  destroyed every night.
- First-party, anonymous statistics only; no third-party analytics, trackers or CDN scripts.
- Photos are re-encoded on the device, reviewed and blurred by a human, and originals are deleted
  after the decision.

## Stack

Vite, React 18, TypeScript (strict), TanStack Router and Query, Tailwind CSS v4, MapLibre GL,
Supabase (Postgres with PostGIS and RLS, Edge Functions on Deno, pg_cron, Storage), Vercel (static
site plus a few edge functions in `api/`), Vitest.

## Getting started

Requirements: Node 22+, a Supabase project (or the Supabase CLI for a local stack) and a Gemini API
key for the collector.

```bash
npm install
cp .env.example .env.local     # set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
```

Useful scripts:

| Command                    | Purpose                                                              |
| -------------------------- | -------------------------------------------------------------------- |
| `npm run check`            | type-check, lint and unit tests                                      |
| `npm run test:db`          | SQL tests on a throwaway local Postgres (PostGIS, pg_trgm, unaccent) |
| `npm run import:schools`   | import the high school directory (needs the service role key)        |
| `npm run import:higher-ed` | import universities, IUTs and schools                                |
| `npm run build`            | production build                                                     |

## Documentation

Detailed notes are in French:

- [docs/architecture.fr.md](docs/architecture.fr.md): collection pipeline, on-site reports, data
  imports, adding sources, tests.
- [docs/deploiement.fr.md](docs/deploiement.fr.md): step-by-step deployment (Supabase, Vercel,
  Cloudflare Turnstile, Gemini).

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a vulnerability, read [SECURITY.md](SECURITY.md)
and do not open a public issue.

## License

The code is released under the [GNU AGPL v3](LICENSE). The published data (the `/donnees` page and
API) is under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/): credit "Manifeste
(manifeste.pandeo.fr)".
