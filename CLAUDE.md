# Manifeste

Live, sourced map of blocked schools and universities in France. Bun workspaces: `apps/server`
(Elysia API, WebSocket, pg-boss worker), `apps/web` (Vite + React SPA), `packages/{core,db,parser,ai}`,
`bench/`, `e2e/`. Postgres + PostGIS, no Redis.

## Rules

- Code, comments, tests, docs, commits and API paths are in English. Only the site's user-facing
  text (and French test data) stays French.
- No tracking, no personal data, every point has a public source (see CONTRIBUTING.md).
- Commits are small and in English. Run `bun run check` before pushing.

## Where to look

| Topic                             | Doc                                                                  |
| --------------------------------- | -------------------------------------------------------------------- |
| Local setup, checks, migrations   | [docs/development.md](docs/development.md)                           |
| Architecture and why              | [docs/adr/0001-v2-architecture.md](docs/adr/0001-v2-architecture.md) |
| Database schema                   | [docs/database.md](docs/database.md)                                 |
| Ingestion pipeline and operations | [docs/ingestion.md](docs/ingestion.md)                               |
| AI layer, models, budget          | [docs/ai.md](docs/ai.md)                                             |
| Movements and events              | [docs/movements.md](docs/movements.md)                               |
| Route detection from the press    | [docs/route-detection.md](docs/route-detection.md)                   |
| Deploy, Cloudflare, backups       | [docs/ops/coolify.md](docs/ops/coolify.md)                           |
| Public API reference              | `/api/docs` on a running server                                      |
| Security reports                  | [SECURITY.md](SECURITY.md)                                           |

## Gotchas

- Elysia: `t.UnionEnum` makes its first value the default; use a union of literals for optional
  enum fields (see `modules/movements/model.ts`).
- New settings go in `packages/core/src/settings.ts` (`public: true` exposes them to visitors).
- Every Elysia route needs `detail.tags`: the OpenAPI plugin uses it to hide staff routes.
- Migrations: edit `packages/db/src/schema/`, then `bun run --filter @manifeste/db generate`.
