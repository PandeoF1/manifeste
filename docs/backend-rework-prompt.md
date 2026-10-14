# Backend rework prompt — Supabase → ElysiaJS on Bun

> Paste this into a fresh Claude Code session at the repo root.

---

Hi. Load the whole project into context first (README, CONTRIBUTING, `docs/`, `supabase/`, `api/`, `scripts/`, `src/`, `tests/`, CI workflows). Read the code before you propose anything.

## 0. What this project is

**Manifeste** is a PWA that maps French high schools (lycées) and higher-ed sites (facs / écoles) blocked or mobilised during the current student movement. Stack today:

- **Front**: Vite + React 18 + TypeScript, TanStack Router/Query, Tailwind v4, MapLibre. UI language is French and stays French for now.
- **Backend**: Supabase (Postgres + PostGIS + `pg_trgm`-style matching, RLS, `pg_cron`, Realtime, Storage, Auth), Deno Edge Functions (`collect`, `reanalyze`, `submit-report`, `purge-submissions`, shared code in `supabase/functions/_shared`), plus Vercel serverless functions in `api/` (open-data API with a 5-minute CDN cache). Hosting: Vercel (`develop` → Preview, `main` → Production, `deploy.yml`).
- **Ingestion pipeline today** (`collector.ts`, `enrich.ts`, `page.ts`, fetchers): sources in `scrape_sources` (Google News RSS with link decoding, press RSS/Atom, Telegram `t.me/s`, Bluesky, Google My Maps KML, article pages) → relevance filter → page enrichment (fetch article, chapô, reconcile published date) → **Gemini** structured extraction (schema-constrained JSON, model fallback chain, thinking budget, strict-prompt variant) → school matching (`match_school`, nearby schools, schools in city, aliases) → date resolution (`resolveObservation`: extracted / announced / published / stale bases, Paris timezone, lycée weekend rule, night rule, >7 days dropped) → `reports` (moderation: pending/validated) or `unmatched_extractions` (7-day retention).
- **Second opinion ("judge")**: **Jev** (TypeSafe AI System One, pinned `jev-1.13.0`, ~$42 per billion input tokens) scores each press report (probability + nature + level) → tiers `confirmed / mobilisation / not retained / not judged` behind a reversible admin setting `judge_tiers`. Page text that sites hide from bots is read through a reader gateway fallback; scripts (`judge:backfill`, `reextract`, optional Playwright `--browser`) clean up history.
- **Other AI use**: media-treatment analysis, re-analysis of unmatched extractions, `ai_usage` token accounting (admin "AI cost" tab).
- **Public side**: no accounts. Anonymous on-site reports (geolocated distance to the school, optional photo that staff blur then the original is purged), anonymous privacy-friendly analytics (live visitors, web vitals), open-data pages/exports, embeds.
- **Staff side**: admin + moderator roles only (Supabase Auth, role in `app_metadata`): moderation queue, unmatched queue, sources, trusted domains, AI usage, judge page, media panel, stats, settings (`app_settings` + `admin_set_setting`), and a **live collection diagram** (SVG, `src/components/admin/live/*`, trace events streamed over Realtime).
- **Quality baseline**: ~350 Vitest tests, SQL tests (`supabase/tests/run-local.sh`), eval/audit scripts (`eval:prompt`, `eval:judge`, `compare:judge`, `audit-reports`), GitHub Actions checks (web, database, supabase).
- Existing hand-reviewed findings worth reusing as benchmark ground truth: whole-DB precision estimate ~44% without the judge vs ~83% with it; Jev nature typing is weak on "closed"; ~17% of press items only ever expose a title because sites 403 bots.

Business rules and invariants to **preserve** (port them, with tests): weekend/night/stale date rules; tier semantics (on-site reports always confirmed; unjudged counts as confirmed until judged; mobilisation never counted as blocked); privacy/retention (no article text stored, extraction context ≤ 7 days, photos purged, no personal data); only staff have accounts; public read endpoints stay cheap and cacheable.

## 1. The task: a total backend rework

Goodbye Supabase, hello **ElysiaJS on Bun**.

1. **First**: create a new branch from `develop` (e.g. `rework/elysia-backend`). Stash/discard whatever is uncommitted on the current branch — I don't care about it.
2. Follow ElysiaJS best practices and its official skills/conventions (feature-module structure, `t` (TypeBox) validation, plugins as separate instances, no controller classes, derive/resolve for context, lifecycle hooks, `@elysiajs/openapi`, Eden Treaty). Goal: a clear, maintainable project.
3. **Everything backend is in English** (code, comments, schema names, docs, logs, commit messages). The front stays French UI-wise for now.
4. You choose the architecture like a real architect. Evaluate each of these and **decide with justification, not by default**:
   - monorepo layout (Bun workspaces: `apps/api`, `apps/web`, shared packages) vs. staying single-package;
   - ORM / query layer (Drizzle vs Kysely vs raw SQL — PostGIS and trigram search are required) and migrations tooling;
   - job queue and workers: BullMQ (needs Redis) vs Postgres-based (pg-boss / Graphile Worker) vs simple in-process scheduler + cron — don't add Redis if it isn't earning its keep at ~100 users; make it trivially swappable later;
   - caching (HTTP cache headers/CDN first, in-memory, Redis later), SQL optimisation (indexes, materialised views vs on-the-fly aggregates for the open-data endpoints), rate limiting and abuse protection for the public report endpoint;
   - realtime: WebSocket (Elysia) fed by Postgres `LISTEN/NOTIFY` or the queue's events, replacing Supabase Realtime;
   - observability: OpenTelemetry (traces, metrics, logs), profiling, structured logging, health/readiness endpoints; pick a cheap backend (Grafana Cloud free tier / self-hosted Jaeger+Prometheus / Better Stack…);
   - API docs: OpenAPI via Elysia, served in a staff-only or public docs page;
   - auth: **only staff have accounts** → evaluate better-auth (admin/role plugin, sessions, optional passkeys/2FA) vs alternatives; moderators keep their restricted powers;
   - file storage for temporary photos (local volume / S3-compatible / R2) with the same purge guarantees;
   - hosting target for Bun + Postgres (Fly.io, Railway, Hetzner VPS + Docker, Neon/Supabase-DB-only…), with a **path to multi-region/redundancy later** (stateless API, idempotent jobs, DB as the only state) but **do not build it now**. Rule: simple, works WELL, cheap. No 50 microservices.
5. **Rule of gold: cheap (side project) but reliable.** Evaluate every spec/solution/optimisation and tell me honestly when something is not worth it yet.

## 2. Ingestion pipeline redesign

Turn today's collector into a real **ingestion system** with explicit stages that can be inspected, retried and benchmarked independently:

`discover/scrape (sites, RSS, files, social, maps)` → `fetch & normalise (robust HTML→text parser)` → `dedupe / same-article merge` → `relevance filter` → `AI extraction` → `school matching` → `date resolution` → `judge (second opinion)` → `store / moderation queue`.

- Scrape all kinds of inputs: websites, RSS/Atom, uploaded files, Telegram/Bluesky, KML. Make adding a source type a single small adapter.
- **Parser**: review the branch `origin/dev/better-html-parser` and improve it further (article extraction quality, paywall/bot-block handling, JSON-LD, date extraction). Keep bot-blocked pages in mind (reader-gateway fallback today; optional headless browser worker later if worth it). Build the parser as a pure, well-tested module with a corpus of real saved pages (fixtures) and a benchmark that scores extraction quality (text recall, school-mention recall, date accuracy, latency).
- Every stage emits structured events (stage, item id, duration, outcome, cost) that feed both OTel and the admin live view.
- Idempotent, resumable, observable jobs; per-source health, backoff and circuit breakers; clear "unmatched" and "unreadable" lanes with retry policies instead of ad-hoc scripts (fold `judge:backfill` / `reextract` / `backfill` into first-class admin-triggerable jobs).

## 3. AI layer: modular, provider-agnostic

- One typed AI module with ports/adapters: tasks (`extract`, `judge`, `media-analysis`, `rematch`) × providers (Gemini now; OpenAI-compatible and Anthropic adapters easy to add; Jev as a judge adapter since it returns calibrated probabilities rather than text).
- **No more dozens of weird env vars and no vendor lock-in**: one validated config (schema-checked, e.g. a single `ai.config.ts` / JSON with per-task provider+model+fallbacks+budgets, secrets only in env). Changing provider or model must be a config change.
- Cost and quality are first-class: token/cost accounting per task/model/source, budgets and kill switches, per-task fallbacks. Today's cost is ~$6/month for extraction on `gemini-3.5-flash-lite`, so don't over-engineer savings — but **do review** which model/provider is best per use case (extraction, judge, media analysis) and tell me if you'd change any, backed by the benchmark below. Stay on Gemini + Jev unless data says otherwise.
- Keep prompts versioned and testable (prompt id/version stored with each result).

## 4. Benchmarks, tests, CI/CD — from day one

- **Benchmark harness** (a solid one): golden datasets (build from the existing hand-reviewed samples and `audit-reports` / `eval:*` scripts), runnable offline against cached responses and live against providers, producing comparable reports (precision/recall per nature/status, date accuracy, school-match accuracy, latency, cost) for **parser variants** and **prompt/model variants**. Results stored/rendered so I can compare runs over time.
- Unit tests for pure logic (date rules, matching, tiers, parser, prompts parsing), integration tests against a real Postgres+PostGIS (Testcontainers or CI service), API contract tests via Eden, queue/worker tests. Port the relevant existing Vitest/SQL tests rather than dropping coverage.
- CI/CD from the start: lint, typecheck, unit + integration, benchmark job (non-blocking, report as artifact), container build, preview deploys, production deploy, migration checks.

## 5. Frontend adaptation

- Edit the whole front to use the **end-to-end type-safe client (Eden Treaty)** instead of `@supabase/supabase-js`: replace `src/queries/*`, auth/session handling, Realtime channels (live diagram, reports) with Eden + WebSocket. Keep TanStack Query.
- Rework the **admin side** to match the new pipeline: the live SVG diagram must reflect the real stages/queues/workers; adapt the AI pages (usage/cost, judge, media), sources, moderation, unmatched, settings.
- Make it **nerdy and fun for a DevOps / stats person**: simple visuals for workers, queue depth, stage funnel (in → relevant → extracted → matched → judged → stored), latency histograms, cost per model, per-source health, parser/prompt benchmark comparisons, trace waterfall, job retry/replay buttons. Simple visualisations of the whole project, not a wall of tables.
- Keep the public site's behaviour and design as is (including the mobilisation/tier display, open-data pages, embeds, PWA).

## 6. Data

- Redesign the database schema from scratch (clean English names, proper constraints/indexes, PostGIS, partitioning/retention where useful). Document it.
- Write a **migration script** that dumps the current Supabase data into the new DB (schools, scrape sources, trusted domains, reports incl. judge columns, unmatched, settings, AI usage, media analyses, staff accounts with roles; skip/aggregate analytics; photos are purged anyway). It must be idempotent, support `--dry-run`, map old → new schema explicitly and verify row counts/invariants afterwards.

## 7. How to work — BEFORE writing code

1. Explore the repo and produce a short **architecture decision record** with the options you evaluated and your recommendation for each item in section 1.4 (including "not now" decisions and why).
2. Then **ask me your questions** to validate the choices (hosting, Redis or not, auth provider, observability backend, monorepo, ORM, anything blocking). Group them, give your recommended answer for each, and wait for my answers.
3. Only after I answer: propose a phased plan (walking skeleton → ingestion + AI ports → admin/live views → data migration → cutover), then implement phase by phase with tests and CI green at each step, committing in small coherent commits.

Goals to optimise for throughout: simple to use, simple to debug, simple to extend, maintainable — we are starting from zero, so take the opportunity to do it right, without over-building.
