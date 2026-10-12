# Operations: Coolify

Production, staging and PR previews run on one server managed by [Coolify](https://coolify.io),
with Cloudflare (free plan) in front. Everything Coolify deploys is a plain Dockerfile or Compose
file from this repository, so moving to another host means reusing the same files.

```
Cloudflare (DNS, TLS, cache, DDoS) ──> Coolify proxy (Traefik)
   manifeste.pandeo.fr         -> manifeste-prod     (deploy/compose.prod.yml: migrate → api + worker)
   staging.manifeste.pandeo.fr -> manifeste-staging  (deploy/compose.staging.yml: ROLE=all)
   <pr>.preview.manifeste…     -> manifeste-preview  (Dockerfile, preview deployments)
Postgres resources: manifeste-db (prod), manifeste-db-staging, manifeste-db-preview
Backups: Coolify scheduled dumps → Cloudflare R2, restore tested weekly by GitHub Actions
```

## 1. Server and Coolify

1. Install Coolify on the server: `curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash`.
   It needs about 2 GB of RAM for itself; the whole stack fits in 8 GB with room for previews.
2. Lock the dashboard down: put it behind Cloudflare Access (free up to 50 users) or allow only
   your IP on its port in the firewall. Enable 2FA on the Coolify account.
3. Firewall: only 22 (SSH, keys only), 80 and 443 open. With Cloudflare proxying, restrict 80/443
   to [Cloudflare IP ranges](https://www.cloudflare.com/ips/).

## 2. Cloudflare

- DNS: `manifeste.pandeo.fr`, `staging.manifeste.pandeo.fr` and `*.preview.manifeste.pandeo.fr`
  as proxied A/AAAA records to the server. SSL mode "Full (strict)" (Coolify issues certificates).
- Cache: static assets are cached by default; API responses carry their own `Cache-Control`
  (open-data endpoints: 5 minutes at the edge). Do not add "cache everything" rules.
- One free rate-limiting rule on `POST /api/reports` (on-site reports) as a second line behind
  Turnstile and the per-visitor daily limit.
- R2: create two private buckets, `manifeste-backups` and `manifeste-corpus` (parser fixtures),
  each with its own API token scoped to that bucket. At our size both stay inside the free tier.

## 3. Databases

Create three PostgreSQL resources in Coolify with the image `postgis/postgis:17-3.5`:

| Resource               | Used by         | Backups                          |
| ---------------------- | --------------- | -------------------------------- |
| `manifeste-db`         | production      | hourly to R2, keep 30 days       |
| `manifeste-db-staging` | staging         | daily to R2, keep 7 days         |
| `manifeste-db-preview` | all PR previews | none (rebuilt from the template) |

For each: no public port, a strong password. Backups: Coolify > the database > Backups >
add the R2 bucket as an S3 storage (endpoint `https://<account>.r2.cloudflarestorage.com`, region
`auto`). Then fill the "Backups" environment in GitHub (see `.github/workflows/restore-test.yml`)
so the weekly restore test can download and check the latest dump.

Preview server only: create a role that may create databases and a template database:

```sql
create role preview login createdb password '<password>';
create database preview_template owner preview;   -- fill with a sanitized dataset later (phase 7)
```

## 4. Applications

### Production: `manifeste-prod`

- New resource > Docker Compose > this repository, branch `main`, file `deploy/compose.prod.yml`.
- Domain on the `api` service: `https://manifeste.pandeo.fr` (port 3000).
- Environment: `IMAGE` only to roll back (default `ghcr.io/pandeof1/manifeste:production`, the tag
  the deploy workflow moves; set a `:<sha>` tag to pin an older build),
  `DATABASE_URL` (internal URL of `manifeste-db`), `AUTH_SECRET` (`openssl rand -hex 32`),
  `PUBLIC_URL` left empty: it is taken from the domain set on the service (`COOLIFY_URL`), and for Grafana Cloud `OTEL_EXPORTER_OTLP_ENDPOINT` +
  `OTEL_EXPORTER_OTLP_HEADERS` (Grafana Cloud > OpenTelemetry > configure).
- Health check: `/api/health/ready`.

### Staging: `manifeste-staging`

Same as production with `deploy/compose.staging.yml`, branch `rework/elysia-backend` (later
`develop`), `manifeste-db-staging`, `PUBLIC_URL` left empty (taken from the service domain).

### PR previews: `manifeste-preview`

> Previews live on their own **Dockerfile** application. Do not enable Preview Deployments on the
> Docker Compose resources (prod, staging): Coolify cannot resolve their compose file for a PR
> (`Docker Compose file not found at: /deploy/compose.staging.yml`) and they would not get a database per PR anyway.
> Object storage: R2 speaks the S3 API, so any S3-compatible bucket works by changing the endpoint and keys.

- New resource > Public/Private repository (GitHub App) > build pack **Dockerfile**.
- Enable **Preview Deployments**, URL template `{{pr_id}}.preview.manifeste.pandeo.fr`.
- Preview environment variables: `ROLE=all`, `AUTH_SECRET`,
  `PREVIEW_DATABASE_SERVER_URL=postgres://preview:<password>@manifeste-db-preview:5432/postgres`,
  `PREVIEW_ID={{pr_id}}` if your Coolify version substitutes it (otherwise the branch name is
  used). Each preview clones `preview_template` into its own database and migrates it at boot;
  databases of previews not booted for 14 days are dropped automatically.
- Previews never get production secrets. AI calls use the replay provider (phase 4), so a
  preview costs nothing and cannot write to production.

## 5. GitHub

- Packages: the deploy workflow pushes `ghcr.io/<owner>/manifeste:<sha>` and moves `:staging` or
  `:production` to it. If the package is
  private, add a GHCR pull token to Coolify (Settings > Docker registries).
- Environments `Staging` and `Production` (required reviewers on Production), each with
  `COOLIFY_WEBHOOK` (the resource's deploy webhook) and `COOLIFY_TOKEN` (Coolify > Keys & Tokens).
- Variables `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_TURNSTILE_SITE_KEY` until the SPA
  moves to the Eden client (phase 6).

## 6. First staff account

```bash
# in the api container (Coolify > manifeste-prod > api > Terminal)
bun staff.js invite admin@example.org "Name" admin
```

Open the printed link to choose a password, sign in, enable TOTP. Until the new admin pages exist
(phase 6), the link and sign-in work through the API (`/api/auth/*`).

## Runbook

| Symptom                               | Look at                                                               |
| ------------------------------------- | --------------------------------------------------------------------- |
| Site down                             | Coolify > api logs; `curl https://…/api/health/ready`                 |
| `migrations` check false in readiness | the `migrate` service logs of the last deploy                         |
| Queue check false                     | worker logs; `select * from pgboss.queue`                             |
| Restore a backup                      | Coolify > database > Backups > restore, or `pg_restore` the dump      |
| Roll back a deploy                    | re-run "Deploy v2" for the previous commit, or redeploy it in Coolify |

## Security headers and Content-Security-Policy

The API sends `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` on every
response, `Strict-Transport-Security` in production, and a Content-Security-Policy with the HTML
pages (`apps/server/src/plugins/security-headers.ts`). The policy only lets in the site itself,
the map host and Cloudflare Turnstile; the pages under `/embed` may be framed by other sites, the
rest cannot be framed at all.

- `CSP_MAP_ORIGINS`: where the map loads its style and tiles from (default
  `https://tiles.openfreemap.org`). **Change it together with `VITE_MAP_STYLE_URL`**, or the map
  goes blank.
- `CSP_MODE`: `enforce` (default), `report-only` (the browser logs violations without blocking:
  use it to try a new map provider or a new third-party script) or `off`.
- If Cloudflare (a Transform Rule) or Traefik already adds a CSP header, both apply and a page
  must satisfy both: remove the proxy's one, or set `CSP_MODE=off` here.
- `e2e/tests/csp.spec.ts` loads every kind of page in Chromium and fails on any violation.
