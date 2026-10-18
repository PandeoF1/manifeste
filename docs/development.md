# Development

v2 layout (see [ADR 0001](adr/0001-v2-architecture.md)):

| Path          | What                                                           |
| ------------- | -------------------------------------------------------------- |
| `apps/server` | Elysia API, WebSocket and job worker (`ROLE=api\|worker\|all`) |
| `apps/web`    | Vite + React SPA (public site and admin), served by the server |
| `packages/db` | Drizzle schema, SQL migrations, test database helpers          |
| `deploy/`     | Compose files for Coolify (production, staging)                |

## Requirements

- [Bun](https://bun.sh) (version in `.bun-version`)
- Postgres 17 with PostGIS 3, pg_trgm and unaccent, reachable on `localhost:54329`

```bash
docker compose -f compose.dev.yml up -d     # Postgres + PostGIS on port 54329
```

Without Docker, any local Postgres 17 + PostGIS works. On Ubuntu without root, the packages can
be unpacked in your home directory:

```bash
apt-get download postgresql-17 postgresql-17-postgis-3 postgresql-17-postgis-3-scripts \
  $(apt-cache depends --recurse --no-recommends --no-suggests postgresql-17-postgis-3 | grep -v '^ ')
for f in *.deb; do dpkg -x "$f" ~/.local/pg17; done
# then: initdb, set port = 54329 in postgresql.conf, pg_ctl start
```

## First run

```bash
bun install
cp .env.example .env          # set AUTH_SECRET (openssl rand -hex 32)
createdb -h localhost -p 54329 -U postgres manifeste_dev
bun run --filter @manifeste/web build           # the server serves apps/web/dist
bun run --filter @manifeste/server dev          # http://localhost:3000, migrations at boot
bun run --filter @manifeste/server staff invite you@example.org "Your Name" admin
```

The invite prints a one-time link to choose a password (no email is sent). Admins must enable
TOTP before any staff route answers. For front-end work, `bun run dev` starts Vite with hot reload.

Useful URLs: `/api/health/ready`, `/api/docs` (public API reference).

## Checks

```bash
bun run check        # typecheck, lint, every workspace's tests
bun run test         # tests only (integration tests need the database above)
```

Integration tests clone a migrated template database per test file (`createTestDb()` from
`@manifeste/db/testing`). Point `TEST_DATABASE_URL` at another server if needed.

## Database changes

1. Edit the schema in `packages/db/src/schema/`.
2. `bun run --filter @manifeste/db generate --name <what_changed>` writes a SQL migration.
   Review it, and add hand-written SQL (functions, triggers) with `--custom` migrations.
3. Never edit a migration that already ran somewhere; add a new one. Keep migrations backward
   compatible with the code still running (add first, remove in a later release).

CI fails when the schema and the migrations drift apart.

## Image

`docker build -t manifeste .` produces one image: `bun index.js` (server), `bun migrate.js`
(one-shot migrations), `bun staff.js …` (staff CLI). The server is bundled with `bun build`,
so the image carries no `node_modules`.

## End-to-end tests

`bun run --filter @manifeste/e2e test:e2e` starts a real server and database (`e2e/server.ts`) and runs the Playwright suites in `e2e/tests`. Install the browser once with `bunx playwright install chromium`. Plain `bun test` at the root also picks up e2e files: run tests per workspace.

## Operations CLIs

- `bun apps/server/src/cli/ingest.ts <backfill|reextract|rejudge|rematch|tick> [--run]`: pipeline operations (dry run by default).
- `bun apps/server/src/cli/staff.ts invite <email> <name> <role>`: invite staff.

## Running the app

`bun run dev` starts the API (port 3000, with `ROLE=all`: api + worker, so the pipeline runs) and Vite (port 5173, proxying `/api`) together. Local defaults come from `apps/server/.env.development` (override with `.env.local`). Postgres must be up first and the `manifeste_dev` database must exist (`docker compose -f compose.dev.yml up -d`). `bun run dev:api` and `bun run dev:web` start one side only; `bun run test:e2e` runs the browser tests.
