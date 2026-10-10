# v2 roadmap

Phases of the rework described in [ADR 0001](adr/0001-v2-architecture.md).

## Phased plan (each phase: tests + CI green, small English commits ending with the Co-Authored-By line)

### Phase 0: Branch and housekeeping

- Move the corpus **out of the repo first** (`cache/`, `urls.json`, `parser-compare.json`, `bench-*.json` → `~/manifest-corpus/`).
  Then `git stash push -u -m "pre-rework leftovers"` for the rest (recoverable, not deleted).
  Then `git switch -c rework/elysia-backend develop`.
- Commit `docs/adr/0001-v2-architecture.md` (the ADR above).

### Phase 1: Walking skeleton (deployable on day 1)

- Bun workspaces. Move the SPA to `apps/web` unchanged. Create `packages/{core,db,parser}`.
- `apps/server`: `src/index.ts` (role switch), plugins `db`, `telemetry`, `auth` (better-auth mount + role macro),
  `queue` (pg-boss), `realtime`, then `modules/health` and `modules/auth-admin` (create/invite staff).
- `packages/db`: Drizzle config, first migrations (extensions, schools, settings, better-auth tables), test helper
  (template DB clone), seed.
- Dockerfile (multi-stage, multi-arch), `compose.dev.yml` (postgis + server), `.env.example` with secrets only.
- CI rewritten (`.github/workflows/ci.yml`, `deploy.yml`). Coolify setup documented in `docs/ops/coolify.md`
  (prod, staging, preview envs, R2 backups, Cloudflare, Grafana Cloud OTLP).
- **Done when**: staging URL serves the SPA, `/api/health/ready`, `/api/docs`. Admin login works with TOTP. A PR opens a preview.

### Phase 2: Domain, schema, public API

- Full schema v2 + `docs/database.md`. `packages/core` gets ported pure logic (`resolveObservation`, tiers, statuses,
  periods, validation, matching rules from `_shared/{extraction,matching,judge-tiers,status}.ts`,
  `src/lib/{periods,timeline}.ts`) with their tests ported.
- SQL matching (trigram/geo/twins/city candidates from migrations 06, 14, 34, 42, 43), ported with integration tests
  from `supabase/tests/*.sql`.
- Public modules: statuses, school, timeline, open data (exports CSV/JSON/GeoJSON), og/share/sitemap (from `api/`),
  analytics (visit, vitals, online), `POST /reports` (Turnstile, hash rate limit, BlobStore, purge jobs). Cache headers, Eden contract tests.

### Phase 3: Parser + benchmark harness

- Upload the corpus to R2 (`bench:corpus:push|pull`). Bootstrap labels from DB reports and hand-reviewed samples,
  then review them.
- `packages/parser` as in D15, with unit tests on synthetic fixtures.
- `bench/` runner: `bun run bench parser --variants develop,better-html-parser,v2` → JSON + markdown report
  (text recall/precision, school-mention recall, date accuracy, blocked detection, p50/p95), stored in `benchmark_runs`.

### Phase 4: AI layer

- `apps/server/src/ai/{config.ts, ports.ts, providers/{gemini,openai-compatible,anthropic,jev,replay}.ts,
tasks/*, prompts/<task>/v<n>.ts, accounting.ts}`, porting `_shared/{gemini,extraction,judge,media,reanalysis}.ts`.
  Recorded-response tests for each adapter. Budgets and kill switch.
- Golden datasets from `audit-manuel-echantillon.json`, `compare-judge-sample-relu.csv` and the eval caches →
  `bench/datasets/*.jsonl`. `bun run bench ai --task extract --variants ... [--live]`: precision/recall per
  nature/status, date accuracy, match accuracy, latency, cost.
- **Model review report** (extract: Flash-Lite vs Flash; judge: Jev vs Gemini; media), with a recommendation backed by numbers.

### Phase 5: Ingestion system

- `src/ingest/adapters/*` (rss/atom, googlenews link decoding, telegram, bluesky, mymaps/KML, upload). Each is one
  file porting `_shared/fetchers/*` and `sources.ts`.
- Stages as pg-boss queues: discover → fetch&parse → dedupe/merge → relevance → extract (batched) → match → date →
  judge → store/moderation. `ingest_items` state machine, idempotent upserts, lanes (`unreadable`, `unmatched`,
  `irrelevant`, `failed`) with retry policies, source health and breaker.
- Every stage emits `pipeline_events` + OTel span + `pg_notify`.
- Jobs replacing scripts: `backfill`, `reextract`, `judge-backfill`, `rematch-unmatched`, `media-analysis`.
  Each takes a scope and dry-run, is admin-triggerable, and has a thin CLI wrapper.

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
