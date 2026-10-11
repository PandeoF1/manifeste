# Ingestion pipeline

How a press article, a post or a map point becomes a report, in explicit stages that can each be
watched, retried and benchmarked. Code: `apps/server/src/ingest`. Pure rules: `packages/core/src/pipeline.ts`.

```
source ──discover──▶ read ──▶ extract ──▶ resolve ──▶ report (+ moderation)
         adapters    fetch      AI         certainty      judge
         relevance   parse      batched    date           store
         breaker     dedupe                match
                                           weekend rule
```

| Stage                            | What it does                                                                                                                                                                         | Where                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| discover                         | Reads one source through its adapter, keeps what is recent, remembers what is new, drops off-topic items on the cheapest text (the source's own). Owns the source's circuit breaker. | `discover.ts`, `adapters/*`                   |
| read (fetch & normalise, dedupe) | Decodes Google News links, fetches the article, cleans it with `@manifeste/parser`, reconciles the publication date, merges the same article received twice.                         | `read-stage.ts`, `reader.ts`, `googlenews.ts` |
| extract                          | One AI call for up to 50 items, across every source.                                                                                                                                 | `extract-stage.ts`, `@manifeste/ai`           |
| resolve                          | Certainty gate, date resolution, school matching (position, city, name), weekend rule, judge, store and moderation, one decision per fact.                                           | `resolve-stage.ts`, `report-store.ts`         |
| media                            | Side stage: how press articles treat the mobilisation. Has its own AI cap and never holds the flow back.                                                                             | `media-stage.ts`                              |

Relevance is applied at discover, on the source's own text, so no page is fetched and no AI call is
spent on an off-topic item. Dedupe is applied in read, on the real article URL, because only then
is it known.

## State machine and lanes

`ingest_items.state`: `discovered → read → extracted → done`. Ends: `irrelevant`, `duplicate`
(merged into another item), `no_event` (the AI found no fact). **Lanes**, the states that need
attention:

| Lane         | Meaning                                                              | How it leaves                              |
| ------------ | -------------------------------------------------------------------- | ------------------------------------------ |
| `unreadable` | the page is blocked, empty or a 404 and the feed gave almost no text | admin retry (re-reads)                     |
| `deferred`   | AI switched off, daily budget reached or billing refused             | automatically, when the AI is usable again |
| `failed`     | a stage failed three times                                           | admin retry (puts it back where it failed) |

What became of each extracted fact is in `extractions.outcome`: `reported`, `duplicate`,
`low_certainty`, `stale`, `weekend`, `unmatched` (waits in the staff queue), `no_source`, `failed`.

## Queue design

Each stage is a **sweep** that handles whatever waits in its state (`ingest.read|extract|resolve|media`),
not a job per item. Consequences: a lost job loses nothing (the next sweep finds the work), a
stage can batch across sources, and a retry is "put the item back in its state". The queues are
`stately` (one waiting and one running per key), so a wake-up that arrives while a sweep runs is
kept for the next one instead of piling up. `ingest.tick` (every 10 minutes) reads the sources
that are due and nudges every sweep as a safety net. `ingest.discover` is one job per source.
Everything is pg-boss in the main Postgres: no Redis.

## Visibility

- `pipeline_events`: one row per step (stage, outcome, duration, item, source, trace id), kept 30
  days. The admin live view, funnel and throughput read it. Aggregated for bulk steps (irrelevant
  items are one row with a count).
- Every stage runs in an OpenTelemetry span and adds its events to it, so Grafana shows the same
  story; the admin does not depend on it.
- A throttled `pipeline` signal on the realtime bus tells open admin tabs to refresh.
- `/api/staff/pipeline/{overview,events,items,throughput}` and `/api/staff/sources` (see `/api/docs`).

## Source health

A circuit breaker per source (`@manifeste/core`): three consecutive failures pause it for 15
minutes, doubling up to 6 hours; after the pause one trial read is allowed (`half_open`); success
closes it. A manual read ignores the pause. `source_runs` keeps the history.

## Operations (replace the one-off scripts)

| Operation   | Use it when                                                                                           | Dry run says                      |
| ----------- | ----------------------------------------------------------------------------------------------------- | --------------------------------- |
| `backfill`  | a source was added, or an outage left a gap: read again over a longer window                          | sources and window                |
| `reextract` | the prompt or model changed: ask the AI again on items already analysed                               | items by recoverability, AI calls |
| `rejudge`   | reports have no second opinion (judge was off or new)                                                 | reports, estimated cost           |
| `rematch`   | the directory changed: try again on the staff queue, optionally with the AI choosing among candidates | queue size, AI calls              |

From the admin: `POST /api/staff/pipeline/operations` (a dry run unless `dryRun: false`; a real
run is queued and audited). From a terminal: `bun run --filter @manifeste/server ingest <operation> [--run]`.
Article text is kept 7 days, so `reextract` can only use stored text inside that window; a press
article is fetched again, a post cannot be.

## Retention

Article text and unmatched excerpts: 7 days. Pipeline events: 30 days. Items (the ledger of what
was seen, no text): 1 year. The nightly `ingest.housekeeping` job applies them.

## Adding a source kind

One adapter file implementing `SourceAdapter` (`normalize`, `discover`), a line in
`adapters/index.ts`, a value in the `source_kind` enum and its migration. Fixtures and tests next to
`apps/server/test/ingest/adapters.test.ts`.

## Not ported

The "upload" adapter of the roadmap (files from the admin) is not built: nothing in production used
it. The legacy collection ran inside a 2-minute edge function with a time budget; the sweeps have
no such limit, so the budget logic is gone (the AI call caps remain).
