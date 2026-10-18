# Movements roadmap: from one school movement to every large movement in France

Status: **plan, nothing built yet.** It follows [movements.md](movements.md) (what exists) and
[route-detection.md](route-detection.md). Written so that development can start when the high
school movement ends, without a new round of design.

## Goal

Follow the news of the large demonstrations and blockades under way in France, several at the same
time, each with its own page, map and data. When a movement ends it is archived and stays readable
at the same address. The high school movement is the first one to be archived.

Scope is **large movements**, not every gathering: an event is shown when it belongs to a movement
or is reported by independent sources (see [Publishing rules](#publishing-rules)). Smaller events
are kept as data and stay out of the public map.

## Principles

1. The **event** is the unit (place, day, cause, source). A **movement** groups events. A route is
   a bonus on an event, never required.
2. **Informative tone** ([CONTRIBUTING.md](../CONTRIBUTING.md)): causes are what the organisers or
   the cited outlet say, with the quote. We never qualify a cause ourselves, and we publish no
   turnout figures (they differ by source and by camp).
3. **A source for every event**, public and checkable. No private channel, no login scraping.
4. **A person decides what is new** (a movement, a cause); **rules decide what is routine**
   (publishing a well-sourced event). The moderation queue must not grow with the volume.
5. Everything is behind settings and a daily AI budget; each part can be switched off alone.

## Decisions already taken

| Question                      | Decision                                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| How a movement is created     | **Suggested by the system**, confirmed in one click by an admin (name, dates). Never created or published on its own. |
| Home page with several active | **One national map with a movement selector.** Archived movements keep their own page and map.                        |
| Turnout figures               | Not stored, not shown.                                                                                                |
| First step                    | Archive the high school movement and give it its page, before any new collection.                                     |

## Current state, in brief

Built: `movements` and `movement_events` (route optional, `announced` or `probable`), admin tabs,
public pages and home-map marches behind `movements_public` and `marches_on_map`, route detection
(school-only, proposals a person validates). Not built: anything outside schools, the lifecycle of
events, per-movement data, the "watch" (`movementId` null).

Two things tie the product to the school movement and must be loosened:

- `movement_start` (a global setting) defines the time range of the whole school map.
- The relevance filter (`packages/core/src/relevance.ts`) requires a school word and a blocking
  word, so no other news reaches the AI.

## Target design

### Data

- `movement_events` gains: `causes` (text array, from a closed list), `organisers` (text array,
  organisations only, never individuals), `quote` (the sentence that backs the event),
  `group_key` (commune + day + cause, like route proposals), `source_count`.
- `causes`: a small table (slug, French label, active). Closed list of 10 to 15 plus "other",
  maintained in the admin. The AI proposes one or more slugs, each with a quote; anything outside
  the list becomes "other" and feeds the suggestion of a new cause.
- `movement_suggestions`: a cluster of events (cause, period, communes, count) that looks like a
  movement, status `pending | accepted | dismissed`. Accepting creates the movement and attaches
  the events.
- `ingest_items.track` (`schools | events`): the two tracks share discover and read, then split.
- `event_extractions`: like `extractions`, for events (outcome, quote, model, prompt version).
- School reports stay as they are. A movement can reference the school map for its period (see
  phase 0), nothing more.

### Pipeline

```
discover ─▶ read ─▶ route by track ─┬─▶ schools: extract ─▶ resolve ─▶ report   (unchanged)
                                    └─▶ events: filter ─▶ AI ─▶ geocode ─▶ group ─▶ publish rules
                                                                                  └▶ suggestions (nightly)
```

- **Events filter (free):** a march / rally / strike / blockade word, a date or a weekday, a
  commune name. Done on the source's own text first, as for schools.
- **AI task `events`:** per article, the events it describes: kind, commune, place if given, day,
  causes, organisers, and a verified quote for each field (same rule as routes: a field whose quote
  is not in the text is dropped). Prompt versioned, replayable offline, with a golden dataset.
- **Geocoding:** commune first (geo.api.gouv.fr), exact place only when the article names it and
  the address base confirms it; otherwise the event is a commune-level point.
- **Routes:** the existing routes stage runs on events that already have a route wording. No
  change to its proposal flow.
- **Grouping:** `group_key` merges reprints of the same dispatch; `source_count` counts distinct
  outlets, not articles.
- **Lifecycle (nightly job):** `planned → ongoing → ended` from the dates; a pending proposal older
  than N days closes itself; `cancelled` when a later source says so.

### Publishing rules

| Situation                                                                | Result                                |
| ------------------------------------------------------------------------ | ------------------------------------- |
| Belongs to an active movement, from a trusted domain                     | Published                             |
| Not in a movement, two independent outlets within the concordance window | Published, counted toward suggestions |
| One untrusted source, or sources disagree on place or day                | Pending, in the admin                 |
| Cause "other", or an organiser the list does not know                    | Pending                               |

Published events carry a label: "announced" (organisers or prefecture), "reported" (press). The
route basis keeps its own dashed or solid rendering. Trusted domains and the concordance window
already exist for school reports (`trusted_domains`, `concordance_window_hours`) and are reused.

### Suggesting a movement

A nightly job looks at events of the last 14 days: at least **N events of the same cause in at
least M communes** (starting values: 15 and 6, to tune on real data) with no movement yet becomes a
suggestion. The admin sees the cause, the dates, the map of the events and the sources, names the
movement and accepts, or dismisses (a dismissed cluster is not suggested again unless it doubles).
A running movement with no event for 14 days is suggested for archiving the same way.

### Public product

- **Home:** the national map shows events of all active movements, with a selector (all, or one).
  Timeline and period picker work per selection. School blockades stay a layer of the high school
  movement.
- **`/mouvements`:** active first, then archives. **`/mouvements/<slug>`:** map, list of events
  by day, sources, causes quoted, link to the data.
- **Neutral wording:** page copy states the cause as "according to the organisers" or "according
  to <outlet>", with the quote one click away. A short editorial note on the site says how events
  are chosen and how to ask for a correction or a removal.
- **Open data:** events of a movement as CSV, JSON and GeoJSON under CC BY 4.0, with a dictionary,
  like the school data.

## Phases

Each phase ships on its own, behind a setting, with tests, and leaves the site working.

**Phase 0: archive the high school movement** (small, no collection change)

- End date set on the movement, `/mouvements/<slug>` page with the school map and the history
  replay attached (listed as "not done" in [movements.md](movements.md)).
- Replace the global `movement_start` by the movement's own dates; the home school layer reads the
  active movement's range.
- Done when: archiving the movement leaves its page, map and data intact and the home no longer
  shows it as running.

**Phase 1: lifecycle and per-movement data**

- Nightly event lifecycle, closing of old proposals, per-movement open data export.
- Done when: a finished march turns `ended` without a click, and a movement's data downloads.

**Phase 2: measure before building** (one afternoon, same method as the route measurement)

- Read 150 recent articles from a generic "manifestation" query, label them, and measure: share
  that is a real event, share with a commune and a day, share with a cause, share of reprints.
- Done when: expected volume per day, AI cost per day and the share of events that would pass the
  publishing rules are written down in `docs/measurements/`.

**Phase 3: events track (collection, off by default)**

- `track`, `event_extractions`, events filter, `events` AI task and prompt with golden dataset,
  commune geocoding, grouping, `causes` table, admin list with the publishing rules, switch
  `event_detection` and its own daily budget. Media analysis stays off for this track.
- Done when: on the labelled sample, precision of published events meets the bar fixed in phase 2,
  and the daily cost stays under the budget.

**Phase 4: suggestions and multi-movement front**

- `movement_suggestions` job and admin tab, home map selector, `/mouvements` and per-movement
  pages for events without a school link, cause filters.
- Done when: a real cluster produces a suggestion, accepting it publishes a movement page.

**Phase 5: sources**

- Regional press and city queries first (existing adapters). Then test structured sources one by
  one (prefecture notices, organisation agendas), each only if machine-readable and allowed. Add
  presets with a category per source.
- Done when: a source's yield (events per week, share published) is visible in the pipeline view.

**Phase 6: go public**

- Editorial note and correction / removal path published, `movements_public` and the new map on,
  alerting on budget and on the size of the pending queue.

## Cost and operations

- Estimate: about 0.0003 USD per article read (Flash-Lite), so roughly 9 USD a month per 1 000
  articles a day, multiplied by about 4 if the fallback model answers. The real volume is unknown
  until phase 2. Start with a low daily cap (for example 2 USD) and raise it after two measured days.
- Dedupe before the AI call by near-identical title plus commune, not only by URL, to skip
  reprints.
- Cost levers, in order: stricter free filter, dedupe, daily cap, fewer sources. Each is a setting
  or a source toggle, no deploy.
- Public OSRM and Nominatim are for routes only; commune geocoding uses geo.api.gouv.fr. If route
  volume grows, self-host (trigger: repeated 429s in the routes stage).
- Monitoring: pending queue size, published per day, AI spend vs cap, source yield, share of
  events corrected by a person (the quality signal).

## Editorial and legal points to settle before going public

- A written definition of "large" (the starting thresholds above) and of what is excluded
  (counter-events, private gatherings, events with no public source).
- Organisers are organisations. Never name a private individual; drop such a name at extraction.
- A visible correction and removal path with a response time, and a rule that a contested event is
  hidden while it is checked.
- Where the data is reused, the CC BY 4.0 credit stays mandatory.

## Open questions

1. **The closed list of causes**: to draft from the phase 2 sample, then you validate it.
2. **Starting thresholds** for suggestions (events and communes), to tune on real data.
3. **Who moderates** the pending queue day to day. Today it is one person; the rules above reduce
   the queue but do not remove it.
4. **Structured sources**: which prefectures and organisations to test first, and whether their
   terms allow reuse.

## Risks

- Quality of the AI on general news is not measured: this is why phase 2 comes before phase 3.
- A cause list that is too fine or contested makes the site look like it takes sides; keep it
  coarse and quoted.
- Volume can outgrow moderation: the publishing rules and the budget cap are the brakes.
- Shared geocoding and routing services are limits we do not control.
