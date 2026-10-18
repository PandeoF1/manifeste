# Database

PostgreSQL 17 with PostGIS, `pg_trgm` and `unaccent`. The schema is written in TypeScript with
Drizzle (`packages/db/src/schema/`), names are English and `snake_case`, and every change is a
reviewed SQL migration in `packages/db/migrations/`. Business rules (tiers, dates, validation)
live in `packages/core` as pure functions, not in triggers; SQL is used for set-based work
(search, matching, aggregates).

## Directory

| Table             | What it holds                                                                                                                                                                                                                                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schools`         | The national directory, identified by UAI (`^[0-9]{7}[A-Z]$`). `level` is `secondary` or `higher`, `location` a `geography(Point, 4326)` (GiST index), `name_norm` and `city_norm` are generated with `normalize_text()` and carry trigram indexes. `aliases` holds other names a school is known by.                                                 |
| `sources`         | Collected sources: `kind` (`telegram`, `rss`, `bluesky`, `mymaps`), normalised `identifier`, `origin`, `trusted` (publishes without moderation), `enabled`, `reports_hidden`, adapter `config`, and the circuit-breaker state (`health`, `consecutive_failures`, `next_attempt_at`, `last_success_at`, `last_error`). Unique on `(kind, identifier)`. |
| `trusted_domains` | Press and union domains whose articles are published without moderation; a domain also trusts its subdomains.                                                                                                                                                                                                                                         |

## Reports

| Table                | What it holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `reports`            | One fact about one school at one moment, with its public source: `status` (`blocked`, `filtering`, `lifted`), `origin` (`press`, `union`, `aggregator`, `on_site`), `moderation` (`pending`, `approved`, `rejected`), `hidden`, `observed_at` (when it happened) with its trace (`published_at`, `extracted_observed_at`, `date_basis`), `certainty`, and the stored `tier`. No article text is stored. Partial indexes serve the public reads (approved and visible, by time) and the moderation queue (pending). |
| `judgements`         | The judge's latest opinion on a report (one row per report): probability, nature, level, raw probabilities, characters read, model and prompt reference.                                                                                                                                                                                                                                                                                                                                                           |
| `report_submissions` | Private details of an on-site report: rounded position, distance to the school, the private photo key. Readable by staff only.                                                                                                                                                                                                                                                                                                                                                                                     |
| `school_proposals`   | An on-site report for a school missing from the directory, checked by staff. Deleted after 7 days.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `moderation_audit`   | Every staff action: who, what, before and after.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

**Tier.** `reports.tier` is computed by `tierOf()` in `@manifeste/core` from the judgement and the
thresholds, and stored so queries stay simple. While the `judge_tiers` setting is off every report
counts; when on, only `confirmed` and `unjudged` reports count as statuses and `mobilisation` ones
are listed apart (never as blocked). On-site reports are always `confirmed`.

**Visibility.** A report is public when `moderation = 'approved'` and not `hidden` (and not in the
future). Pending, rejected and hidden reports never leave the staff API.

## Settings and accounts

| Table                                                                                                  | What it holds                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `settings`                                                                                             | Runtime settings (`status_ttl_hours`, `movement_start`, `judge_tiers`, `judge_keep`, `judge_low`, `concordance_window_hours`). Values are JSON, validated against the schemas in `packages/core/src/settings.ts` on every read and write. |
| `auth_user`, `auth_session`, `auth_account`, `auth_verification`, `auth_two_factor`, `auth_rate_limit` | Staff accounts, managed by better-auth. Only staff have accounts; roles are `admin` and `moderator`.                                                                                                                                      |

## Anonymous analytics and privacy

| Table                                            | Retention                                                                                                            |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `daily_salts`                                    | Today's random salt only; older salts are deleted every night, which makes visitors unlinkable across days.          |
| `analytics_visitors_today`                       | SHA-256(salt, IP) of today's visitors; counted into `analytics_daily` and deleted overnight. The IP is never stored. |
| `submission_limits`                              | Reports per visitor hash and day (limit 5); deleted overnight.                                                       |
| `analytics_page_views`, `analytics_new_visitors` | 5-minute slots, kept 120 days.                                                                                       |
| `analytics_live`, `analytics_online`             | Open tabs (10 minutes) and visitors online per minute (14 days).                                                     |
| `analytics_vitals`                               | Web vitals and API latency, 30 days.                                                                                 |
| `analytics_daily`                                | Unique visitors per day, kept.                                                                                       |

Photos are not in the database: originals live in the private area of the blob store and are
deleted once the report is decided or after 48 hours, by the hourly purge job and by a disk sweeper
that deletes any private file older than 48 hours whatever the database says.

## Ingestion and AI

| Table             | Content                                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `ingest_items`    | One row per thing a source published; `state` is its place in the pipeline, lanes included. Replaces the old "seen" table. |
| `item_contents`   | The text read for an item. Deleted after 7 days.                                                                           |
| `extractions`     | One row per fact the AI extracted, with model and prompt version, and what became of it (`outcome`, school, report).       |
| `unmatched`       | Facts about a school the directory could not identify: the staff queue. The excerpt is deleted after 7 days.               |
| `pipeline_events` | One row per pipeline step, kept 30 days (admin live view, funnel, history).                                                |
| `source_runs`     | One row per read of a source.                                                                                              |
| `media_analyses`  | How press articles treat the mobilisation: answers and two short quotes, no text.                                          |
| `ai_usage`        | Calls, tokens and estimated cost per hour, task, provider, model and prompt version.                                       |

Still planned: `benchmark_runs` and `benchmark_results` (benchmark runs are JSON files in `bench/results` for now),
plus the pg-boss tables in the `pgboss` schema (created by pg-boss itself).

## SQL helpers

`immutable_unaccent(text)`, `normalize_text(text)` (lowercase, no accents, single spaces) and
`strip_generic_words(text)` (drops "lycée", "de", "professionnel"… so only the distinctive part of
a name is compared). `strip_generic_words` mirrors `stripGenericWords` in `@manifeste/core`.
