# Deploying Manifeste, step by step (legacy Supabase + Vercel stack)

> **Legacy.** This guide describes the Supabase and Vercel deployment that the v2 rework replaces.
> Until the cutover (see [the roadmap](../v2-roadmap.md), phase 8) it still describes production.
> The v2 stack is documented in [docs/ops/coolify.md](../ops/coolify.md). Script commands below run
> from `legacy/` (`bun run --filter @manifeste/legacy <script>`).

Duration: about 1 h. Cost: €0 to start (free tiers), except Gemini (see step 3).
Run the commands from the repository root, on your computer (Node 22+).

## 0. Accounts to create

| Service          | What for                                          | Link                |
| ---------------- | ------------------------------------------------- | ------------------- |
| Supabase         | database, functions, photo storage, admin account | supabase.com        |
| Vercel           | website + share images                            | vercel.com          |
| Cloudflare       | Turnstile anti-bot for the report form            | dash.cloudflare.com |
| Google AI Studio | Gemini API key (AI extraction)                    | aistudio.google.com |

## 1. Supabase: project

1. **New project**, region **Europe (Paris `eu-west-3` or Frankfurt `eu-central-1`)**. Keep the database password.
2. **Project Settings > API**: note the `Project URL`, the `anon` key (public) and the `service_role` key (secret, never in the front end).
3. **Authentication > Sign In / Providers > Email**: untick **Allow new users to sign up**.
4. **Authentication > URL Configuration**: Site URL = the Vercel address (updated at step 6).

## 2. Supabase: database, functions, scheduling

```bash
npm install
npx supabase login
npx supabase link --project-ref <ref>        # <ref> = the identifier in the project URL
npx supabase db push                          # creates tables, RLS, photo buckets, scheduled jobs
```

In the **SQL Editor**, store the secrets read by the scheduled jobs (replace `<ref>` and pick a long secret):

```sql
select vault.create_secret('https://<ref>.supabase.co/functions/v1/collect', 'collect_url');
select vault.create_secret('https://<ref>.supabase.co/functions/v1/purge-submissions', 'purge_url');
select vault.create_secret('<COLLECT_SECRET>', 'collect_secret');   -- openssl rand -hex 32
```

Check in **Database > Extensions** that `pg_cron` and `pg_net` are enabled, and in
**Integrations > Cron** that the jobs `collect-sources`, `purge-submissions`, `purge-rate-limits`
and `purge-collector-traces` exist. If `pg_cron` was not enabled during `db push`, enable it,
then replay in the SQL Editor the contents of the migration `20261004000008_cron.sql` and section 8
of `20261005000010_user_submissions.sql`.

## 3. External keys

- **Gemini**: aistudio.google.com > _Get API key_. Enable billing (paid tier): on the free tier,
  Google may use the submitted content to improve its models.
  Indicative cost: a few euros per month with about ten sources.
- **Turnstile**: Cloudflare > _Turnstile_ > _Add widget_, mode _Managed_, domains: your Vercel domain
  (+ `localhost` to test). Note the **Site key** and the **Secret key**.

## 4. Supabase: secrets and functions

```bash
npx supabase secrets set \
  GEMINI_API_KEY=<gemini key> \
  GEMINI_MODEL=gemini-3.5-flash-lite \
  COLLECT_SECRET=<the same secret as in step 2> \
  COLLECT_MIN_CERTAINTY=moyenne \
  TURNSTILE_SECRET_KEY=<turnstile secret key>

Optional: the Jev judge (TypeSafe AI) scores each readable press report (score, nature, level,
stored in `reports.judge_*`). Observation mode: nothing is shown or counted with these scores.
`npx supabase secrets set TYPESAFE_API_KEY=<key>` enables it; `JEV_JUDGE=0` turns it off without removing the key. When a site refuses robots (403) and the feed only gives the title, the page is read through the public gateway r.jina.ai (at most 20 pages per run, only the article link, for the judge only); the text is only kept if it talks about the school.

npx supabase functions deploy collect --no-verify-jwt
npx supabase functions deploy submit-report --no-verify-jwt
npx supabase functions deploy purge-submissions --no-verify-jwt
npx supabase functions deploy reanalyze --no-verify-jwt
```

**Gemini quotas (free tier)**: Flash models are limited to 5 requests/min and 20/day,
Flash-Lite to 15/min and 500/day. The default model is therefore `gemini-3.5-flash-lite`, and the
collection sends all the items of a run in a single call (60 items per request). With billing
enabled, you can switch to `GEMINI_MODEL=gemini-3.8-flash`.

**Media analysis**: `MEDIA_MODEL` (secret of the `collect` function) chooses the model for this
analysis, separately from extraction; without it, `GEMINI_MODEL` applies. To redo the analyses
already in the database with another model or an updated instruction:
`GEMINI_API_KEY=… npm run backfill -- media --redo --model gemini-3.8-flash` (resumes automatically).

**Cost and consumption**: each run writes a `gemini_usage` line in the `collect` function logs
(input, output and thinking tokens, per task and per model), and the admin sources page shows the
tokens of the last run. A 402 (credit exhausted or spending cap reached at Google) stops the run
without insisting: the items are picked up at the next one.
`GEMINI_THINKING_BUDGET=0` turns off thinking for extraction (`-1` or absent: the model's setting;
a model that refuses the setting is called again without it). Media analyses and re-analysis turn it
off by default (`MEDIA_THINKING_BUDGET`, `REANALYZE_THINKING_BUDGET`). `EXTRACTION_TEXT_CHARS` limits the
text sent per item (6000 by default): `npm run eval:truncation` first measures what a cut
would lose on the production articles.

If Gemini is overloaded (503 error), the collection retries then falls back to a backup model
(`GEMINI_FALLBACK_MODELS`, by default `gemini-3.5-flash,gemini-3.6-flash,gemini-3.8-flash`).

## 5. School directory and admin account

```bash
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service_role> \
  npm run import:schools -- --dry-run      # checks the format (should announce ~4,000 lycées)
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service_role> \
  npm run import:schools                   # real import (can be rerun)
```

Universities, IUTs and schools (~860 sites, public and private) go in the same table:

```bash
npm run import:higher-ed -- --dry-run      # announces ~860 sites
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service_role> \
  npm run import:higher-ed                 # real import (can be rerun)
```

Source: data.enseignementsup-recherche.gouv.fr (locations of public institutions, and main
institutions). Since a blockade targets a site, the faculties (UFR) of one place (within 700 m)
are grouped into a single point named after the institution and the city.

If the script reports a changed schema, send its output to the maintainer.

Check in the SQL Editor: `select count(*) from schools;` should return several thousand.
Without the directory, no fact extracted by the AI can be attached (everything goes to
"Non rattachés"). After the import, click **Admin > Non rattachés > Réessayer le rattachement
automatique** to pick up those already collected.

Admin account: **Authentication > Users > Add user** (email + strong password, _Auto confirm_), then:

```sql
update auth.users set raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}'
where email = '<your admin email>';
```

## 6. Vercel

1. Push the code to the default branch (merge the working branch into `main`).
2. vercel.com > **Add New > Project** > import the repository. Framework: **Vite** (detected).
3. **Environment Variables** (Production + Preview):

| Variable                  | Value                       |
| ------------------------- | --------------------------- |
| `VITE_SUPABASE_URL`       | `https://<ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY`  | `anon` key                  |
| `VITE_TURNSTILE_SITE_KEY` | Turnstile site key          |

4. **Deploy**. Optional: _Settings > Domains_ for a domain name of your own.
5. Put the final address in Supabase (step 1.4) and in the Turnstile widget (step 3).

## 7. Legal texts

Fill in `apps/web/src/config/legal.ts` (contact email, hosts' addresses), commit, push:
Vercel redeploys by itself.

## 8. Getting started

1. `https://<your-site>/admin` > sign in.
2. **Sources** > click the two Google News presets, add public Telegram channels
   and Bluesky accounts. Tick _Confiance_ only for reliable sources.
3. **Lancer la collecte**: the table shows, per source, the items read, the facts extracted
   by the AI and the signals created. An empty _Erreur_ column = all is well.
4. After that the collection runs by itself every 10 minutes. Uncertain signals arrive in
   **Modération**; schools the AI could not identify in **Non rattachés**.

## 8 bis. Catching up on history (optional)

Fetches from Google News everything published since the start of the movement, queues it
in the database (`backfill_queue`), then has the AI analyse it with exactly the same processing as
the collection: attaching to schools, validation, **Non rattachés**, log in the admin (source
"Rattrapage Google Actualités (CLI)"). Run it from your PC (WSL), once the migrations are applied.

Create `.env.backfill` at the root (ignored by git):

```
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role key: Project Settings > API>
GEMINI_API_KEY=<your key>
```

```bash
npm run backfill -- fetch --since 2026-09-14 --dry-run   # simulation: how many articles
npm run backfill -- fetch --since 2026-09-14             # fills the queue (~5 min)
npm run backfill -- process                              # drains the queue into the AI
npm run backfill -- status                               # where the queue stands
npm run backfill -- retry-errors                         # requeues failed articles
```

- `fetch` queries each preset query day by day. On a peak day (Google cuts at
  100 articles), the feed is rerun region by region. Off-topic articles are not kept.
- `process` handles the oldest first, 60 articles per Gemini call, 10 calls per minute at
  most (`--rpm`). About 3,900 articles since 14 September, i.e. 65 calls: that fits in the daily
  free quota. If the quota runs out, it stops cleanly: rerun it later, it
  resumes where it was. `--max-calls 20` to go in small chunks.
- Backfilled signals keep their real date: they fill the history of the school pages
  but do not appear on the live map (which only shows the last few hours).
- Only the link, the publisher and the title (erased once processed) are stored, never the text.

## 9. Checking share previews

- Paste `https://<your-site>/` then `https://<your-site>/lycee/<UAI>` in Discord, Telegram, WhatsApp.
- Direct image: `https://<your-site>/api/og` and `https://<your-site>/api/og?uai=<UAI>`.
- Messaging app caches: Telegram keeps the preview in cache (the **@WebpageBot** bot refreshes it);
  WhatsApp uses Facebook's cache (Meta's _Sharing Debugger_ tool).

## 10. Checking the PWA

On a phone, open the site twice: the "Install" prompt appears (Android/Chrome).
On iPhone: Share > _Add to Home Screen_. Cut the network: the map shows
"Hors ligne · données de HH:MM".

## Good to know

- **Collection scaling**: each run is split into sub-calls of 4 sources
  (each with its own budget of 2 s CPU and 256 MB), 4 in parallel, 80 sources at most per
  run (the least recently collected first). Adjustable with `COLLECT_SOURCES_PER_WORKER`,
  `COLLECT_WORKER_CONCURRENCY` and `COLLECT_MAX_SOURCES_PER_RUN`. The relevant items of
  several sources share the same Gemini call (batches of 20).

- **Free Supabase** pauses the project after 7 days without activity. The collection every
  10 minutes keeps it active, but move to the Pro plan if the audience grows.
- **Logs**: Supabase > Edge Functions > _Logs_ (collection, submissions). No IP or report
  content is written there by the code.
- **Logo update**: edit `brand/logo-mark.svg` then `bun run --filter @manifeste/web brand`.
