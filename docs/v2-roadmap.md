# v2 roadmap

Phases of the rework described in [ADR 0001](adr/0001-v2-architecture.md).

## Phased plan (each phase: tests + CI green, small English commits ending with the Co-Authored-By line)

### Phase 0: Branch and housekeeping (done)

- Move the corpus **out of the repo first** (`cache/`, `urls.json`, `parser-compare.json`, `bench-*.json` → `~/manifest-corpus/`).
  Then `git stash push -u -m "pre-rework leftovers"` for the rest (recoverable, not deleted).
  Then `git switch -c rework/elysia-backend develop`.
- Commit `docs/adr/0001-v2-architecture.md` (the ADR above).

### Phase 1: Walking skeleton (deployable on day 1) (done)

- Bun workspaces. Move the SPA to `apps/web` unchanged. Create `packages/{core,db,parser}`.
- `apps/server`: `src/index.ts` (role switch), plugins `db`, `telemetry`, `auth` (better-auth mount + role macro),
  `queue` (pg-boss), `realtime`, then `modules/health` and `modules/auth-admin` (create/invite staff).
- `packages/db`: Drizzle config, first migrations (extensions, schools, settings, better-auth tables), test helper
  (template DB clone), seed.
- Dockerfile (multi-stage, multi-arch), `compose.dev.yml` (postgis + server), `.env.example` with secrets only.
- CI rewritten (`.github/workflows/ci.yml`, `deploy.yml`). Coolify setup documented in `docs/ops/coolify.md`
  (prod, staging, preview envs, R2 backups, Cloudflare, Grafana Cloud OTLP).
- **Done when**: staging URL serves the SPA, `/api/health/ready`, `/api/docs`. Admin login works with TOTP. A PR opens a preview.

### Phase 2: Domain, schema, public API (done, except the staff-side endpoints)

- Full schema v2 + `docs/database.md`. `packages/core` gets ported pure logic (`resolveObservation`, tiers, statuses,
  periods, validation, matching rules from `_shared/{extraction,matching,judge-tiers,status}.ts`,
  `src/lib/{periods,timeline}.ts`) with their tests ported.
- SQL matching (trigram/geo/twins/city candidates from migrations 06, 14, 34, 42, 43), ported with integration tests
  from `supabase/tests/*.sql`.
- Public modules: statuses, school, timeline, open data (exports CSV/JSON/GeoJSON), og/share/sitemap (from `api/`),
  analytics (visit, vitals, online), `POST /reports` (Turnstile, hash rate limit, BlobStore, purge jobs). Cache headers, Eden contract tests.

### Phase 3: Parser + benchmark harness (done, except storing runs in `benchmark_runs`)

- Upload the corpus to R2 (`bench:corpus:push|pull`). Bootstrap labels from DB reports and hand-reviewed samples,
  then review them.
- `packages/parser` as in D15, with unit tests on synthetic fixtures.
- `bench/` runner: `bun parser/run.ts --variants legacy,branch,v2 --labelled` (from `bench/`) → JSON + markdown table
  (text recall/precision, school-mention recall, date accuracy, blocked detection, p50/p95), stored in `benchmark_runs`.

### Phase 4: AI layer (done, except the live model review)

- `packages/ai` (a package rather than `apps/server/src/ai`, so the benchmarks run the very same code): ports,
  adapters (Gemini, OpenAI-compatible, Anthropic, Jev, replay at model and HTTP level), the chain with its
  retry/fallback policy, TypeBox-validated config with kill switch, daily budget and prices, versioned prompts,
  extract/judge/reanalyse/media tasks. Server wiring: `ai_usage` accounting, `/api/staff/ai/*`. See `docs/ai.md`.
- Golden dataset `bench/datasets/ai/reports.jsonl` (223 hand-labelled reports) and `bench/ai/run.ts`
  (judge and extraction, offline replay or `--live`, budget cap, AUC / threshold sweep / kept rates / cost / latency).
- **Model review report**: `docs/ai-model-review.md` has the procedure; the live run needs API keys and is still to do.

### Phase 5: Ingestion system (done, see `docs/ingestion.md`)

- Adapters (RSS/Atom, Telegram, Bluesky, My Maps) with identifier normalisation, Google News decoding, the reader on
  `@manifeste/parser`, stages as stately pg-boss sweeps, `ingest_items` state machine with the `unreadable`,
  `deferred` and `failed` lanes, source circuit breaker, `pipeline_events` + OTel spans + realtime signal, 119 presets.
- Operations replacing the scripts, each with a dry run: `backfill`, `reextract`, `rejudge`, `rematch` (admin API and CLI);
  media analysis as a side stage.
- Staff API: `/api/staff/sources`, `/api/staff/pipeline/*`. The moderation and unmatched queues come with the admin (phase 6).
- Not ported: the "upload" adapter (unused).

### Phase 6: Front end (public, then admin)

- Eden client in `apps/web/src/lib/api.ts`. Rewrite `src/queries/*`, replace `realtime.ts`/`useTraceStream.ts` with WS,
  auth via better-auth client, `signaler` flow. Playwright smoke tests (map, list, school, données, embed, report) on previews.
- Admin: live SVG diagram on real stages and queues, funnel, queue depth/workers, latency histograms, cost per model, source
  health, benchmark comparisons, per-item trace waterfall, retry/replay. Moderation, unmatched, sources, trusted
  domains, AI, judge, media, settings, stats pages are ported (following the `dataviz` conventions).

### Phase 7: Data migration

- `bun run migrate:supabase [--dry-run]`: explicit per-table mapping (schools, sources, trusted domains, reports +
  judge columns → `judgements`, unmatched, settings, ai_usage, media analyses, moderation audit, staff → invites with
  roles; analytics aggregated only; ad-hoc backup tables, logs and photos skipped).
- Upserts on stable keys (`legacy_id`), so it's idempotent. A verification report covers row counts per table and
  invariants (every validated report has a school; tier counts equal the old ones; settings parse).
- It runs repeatedly against staging.

### Phase 8: Shadow run + cutover

- v2 prod ingests in parallel for 3–7 days (AI cost about +$6). A daily diff of v2 reports vs Supabase reports goes into a report.
- Cutover: final migration run → Cloudflare DNS switch → Supabase kept read-only for 2 weeks as the rollback path → then
  decommission Supabase, the Vercel project and the edge functions.

## Verification (each phase)

- `bun run check` (lint, typecheck, unit) · `bun run test:int` (needs `docker compose -f compose.dev.yml up db`)
- `bun run bench parser|ai --offline` reports in CI artifacts
- Staging/preview checks: `/api/health/ready`, `/api/docs`, Playwright smoke, admin login + TOTP, live diagram during a manual collect
- Migration: `--dry-run` diff report, then a real run on staging, verification report green
- Restore test workflow green (latest R2 dump restored, invariants hold)
