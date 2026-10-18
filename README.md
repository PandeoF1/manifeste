# Manifeste

![Manifeste](apps/web/brand/logo-horizontal.png)

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

The architecture and the reasons behind it are in [ADR 0001](docs/adr/0001-v2-architecture.md).

- **Front end** (`apps/web`): Vite, React 18, TypeScript (strict), TanStack Router and Query,
  Tailwind CSS v4, MapLibre GL.
- **v2 backend** (`apps/server`, `packages/*`): Bun, Elysia (HTTP, WebSocket, jobs), Postgres with
  PostGIS and Drizzle, pg-boss queue, better-auth for staff accounts, OpenTelemetry, deployed with
  Coolify.

## Getting started

Requirements: [Bun](https://bun.sh) and a Postgres 17 with PostGIS. Details in
[docs/development.md](docs/development.md).

```bash
bun install
cp .env.example .env           # set AUTH_SECRET, DATABASE_URL
bun run --filter @manifeste/web build
bun run --filter @manifeste/server dev
```

Useful scripts:

| Command                                   | Purpose                                                |
| ----------------------------------------- | ------------------------------------------------------ |
| `bun run check`                           | type-check, lint and unit tests for every workspace    |
| `bun run test`                            | tests only (integration tests need the local Postgres) |
| `bun run dev`                             | Vite dev server for the front end                      |
| `bun run --filter @manifeste/server dev`  | the API and worker, with migrations applied at boot    |
| `bun run --filter @manifeste/db generate` | write a SQL migration from a schema change             |

## Documentation

- [docs/development.md](docs/development.md): layout, local setup, checks, database changes.
- [docs/adr/0001-v2-architecture.md](docs/adr/0001-v2-architecture.md): the architecture decisions.
- [docs/ingestion.md](docs/ingestion.md), [docs/ai.md](docs/ai.md), [docs/movements.md](docs/movements.md), [docs/route-detection.md](docs/route-detection.md): how the pipeline, the AI layer and the movements work.
- [docs/ops/coolify.md](docs/ops/coolify.md): running production, staging and PR previews.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a vulnerability, read [SECURITY.md](SECURITY.md)
and do not open a public issue.

## License

The code is released under the [GNU AGPL v3](LICENSE). The published data (the `/donnees` page and
API) is under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/): credit "Manifeste
(manifeste.pandeo.fr)".
