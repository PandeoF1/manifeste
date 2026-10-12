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
- Health check: `/api/health/ready`. It answers 200 as long as the database, the migrations and the
  queue are fine. The photo storage is reported in `checks.photos` (reachable, latency) but does
  not decide: if it fails, `degraded` lists `photos` and the answer stays 200 and `ready`, so
  Coolify does not pull the whole site for a photo problem. Alert on it from the uptime monitor
  (a keyword check on `"degraded":[]`). The probe asks the bucket for one key, is cached for
  30 s and gives up after 3 s. `/api/health/live` never looks at any dependency.

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

## Photos in Cloudflare R2 (or any S3 bucket)

By default photos live on a Docker volume (`BLOB_STORE=fs`). With `BLOB_STORE=s3` they live in a
bucket instead: no volume to back up, the API and the worker no longer need to share a disk, and
the API can run on several servers. Nothing else changes: the originals under `private/`, the
blurred photos under `public/`, the 48 h retention, the API serving `/api/photos/…`.

### Set up (once)

1. **R2 → Create bucket** (e.g. `manifeste-photos`). Leave it **private**: do not enable the
   `r2.dev` URL nor a custom public domain. The API reads it with its own key and serves the
   published photos itself (they are immutable and cached by Cloudflare).
2. **R2 → Manage API tokens → Create**, permission _Object Read & Write_, restricted to that
   bucket. Keep the Access Key ID and Secret Access Key.
3. **Bucket → Settings → Object lifecycle rules**: add a rule on the prefix `private/` that deletes
   objects after **2 days**. The retention sweeper already does it; this is a second net, so that
   an original cannot outlive the 48 h promise even if the worker is down.
4. In Coolify, for the `api` and `worker` (the same values for both):

   | Variable                                    | Value                                            |
   | ------------------------------------------- | ------------------------------------------------ |
   | `BLOB_STORE`                                | `s3`                                             |
   | `S3_BUCKET`                                 | `manifeste-photos`                               |
   | `S3_ENDPOINT`                               | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`  |
   | `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | the token                                        |
   | `S3_REGION`                                 | `auto` (default)                                 |
   | `S3_PREFIX`                                 | optional: `prod/` to share a bucket with staging |

   Any other S3 server works the same way (AWS S3: no `S3_ENDPOINT`, set `S3_REGION` and
   `S3_VIRTUAL_HOSTED=true`; MinIO: `S3_ENDPOINT=http://minio:9000`, `S3_REGION=us-east-1`).

5. At start the API logs `photo storage reachable` or, if the bucket or the key is wrong,
   `photo storage NOT reachable`: check that line after a deploy.

### Moving the existing photos (production already running on the volume)

The published photos must follow, or the pages that show them would lose their image.

1. Set the `S3_*` variables on the `api` container but **keep `BLOB_STORE=fs`** for now.
2. In the `api` container (the volume is mounted on `/data`):
   `bun copy-blobs.js` (a dry run: what would be copied), then `bun copy-blobs.js --run`.
   It is safe to repeat: what is already in the bucket is skipped.
3. Switch `BLOB_STORE=s3` on `api` and `worker` and redeploy. Photos sent between step 2 and the
   switch stay on the volume: run `bun copy-blobs.js --run` once more just before switching.
4. Keep the volume for a few days, then remove it.

To go back: `bun copy-blobs.js --run --reverse`, then `BLOB_STORE=fs`.

### Migrating from Supabase straight into the bucket

`migrate:supabase --photos` copies the published photos into the configured store: with
`BLOB_STORE=s3` they go directly into the bucket.

### Privacy

The bucket is the only copy of the originals while they await moderation (48 h at most). It is
encrypted at rest by R2 and private. Do not give the token more than Object Read & Write on this
one bucket, and do not reuse the bucket for anything public.
