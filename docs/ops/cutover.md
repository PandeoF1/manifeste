# Cutover runbook: Supabase/Vercel to v2 (Bun + Elysia)

Everything public currently sits behind a Cloudflare Worker, so the switch is a routing change there, not a DNS move.

## 0. Prerequisites

- Coolify app deployed from the `Dockerfile` (roles `api` + `worker`, or `all`), Postgres with PostGIS, `/data` volume.
- Env set from `.env.example`; `SUPABASE_DB_URL` points at the **read-only** Supabase connection string.
- R2 backups running and one restore test green. Grafana Cloud receiving traces.

## 1. Rehearsal on staging (repeat until boring)

1. `bun migrate.js` (schema).
2. `bun migrate-supabase.js --dry-run` and read the report (row counts, invariants).
3. `bun migrate-supabase.js --run`. Run it twice: the second run must report 0 inserted (idempotent).
4. Staff: `bun staff.js invite <email> <name> <role>`; each person sets a password, admins enrol TOTP.

## 2. Shadow run (at least 3 days)

- Production keeps serving from Supabase. v2 ingests in parallel (`INGEST_ENABLED=true`, AI budget capped by `AI_DAILY_BUDGET_USD`).
- Daily: `bun shadow-compare.js` (v2 reports vs Supabase reports).
- Acceptance: no school status disagreement that a moderator cannot explain, v2 misses fewer than 5% of Supabase reports, no source stuck in circuit-breaker, p95 API latency under 300 ms, AI cost within budget.

## 3. Cutover

1. Announce a 15 minute freeze of moderation.
2. Final `migrate-supabase.js --run`; verify the report is green.
3. In the Cloudflare Worker, route `/*` to the Coolify origin (keep the previous origin config at hand).
4. Check: `/api/health/ready`, map loads, a test report, admin login with TOTP, a manual collect shows on the live diagram.
5. Disable Supabase cron/edge functions so only one system ingests.

## 4. Rollback (within about 2 h)

- Point the Worker back at the Vercel/Supabase origins, re-enable the Supabase cron.
- Reports submitted on v2 meanwhile are in the v2 database: export them and replay into Supabase by hand if any.

## 5. Decommission (after about 30 days)

Keep Supabase read-only for 30 days, take a final dump to R2, then delete the Supabase project and the Vercel project (the legacy code is already gone from the repository: see the git history before the commit that removed `legacy/`).
