# Prompt — zero-AI word statistics for the Medias page

> Paste this into a fresh Claude Code session at the repo root (branch from `develop`).

---

Read the code before proposing anything: `apps/server/src/ingest/media-stage.ts`, `read-stage.ts`,
`apps/server/src/modules/insights/index.ts`, `packages/db/src/schema/ingest.ts` (`mediaAnalyses`,
`itemContents`), `packages/parser`, `packages/core/src/relevance.ts`,
`apps/web/src/components/admin/MediaPanel.tsx`, and `docs/` for the privacy rules.

## Context and goal

The admin **Medias** tab currently runs an AI call per batch of press articles (`mediaSweep`,
`maxMediaCalls`, `analyseMedia`) to describe how each article treats the mobilisation. At full
coverage this costs too much, so today it only covers a capped slice of the articles.

Add a **deterministic, zero-AI-cost statistics layer** built from word counts over *all* press
articles that the pipeline reads, and make it the backbone of the Medias page. The AI analysis
stays, but becomes optional and sampled (a small budget, e.g. the N most recent or most
ambiguous articles), displayed next to the counts, never required for the page to be useful.

## Hard constraints

1. **Privacy invariant: never store article text.** Retention of extracted context stays as it is.
   Persist only **aggregated counters** `(day, publisher domain, term) → count` and
   `(day, domain, term) → number of distinct articles containing it`. A term count must not allow
   rebuilding an article. Drop terms below a minimum document frequency, and cap the vocabulary
   per day. State the privacy argument in the migration comment and in `docs/`.
2. **No extra fetch.** Count in the existing `read` stage, where the article text is already in
   memory, in the same transaction/idempotent step as the read result. A re-run of the same item
   must not double-count (idempotency key = item id; keep a small `counted_items` marker, or make
   the counting an upsert keyed on a per-item flag).
3. **Dedupe wire copies.** An agency dispatch republished by many outlets must not inflate the
   numbers. Reuse the pipeline's same-article merge (`absorbed`/`kept` in `read-stage.ts`): count
   an article once per merged group, and credit the other outlets as "relays" in a separate column.
4. **Cheap and bounded.** Aggregates in one table with a composite primary key and `ON CONFLICT DO
   UPDATE SET count = count + excluded.count`. Retention job: delete rows older than a configurable
   number of days (default 180). Give a back-of-envelope size estimate (distinct terms × days ×
   domains) before choosing the cap.
5. **Quality-aware.** About 17 % of items only expose a title (sites block bots). Track per domain
   the share of articles read in full vs title only, store it, and show it next to every metric so
   a blocked outlet is not read as "silent". Counting must work on titles too but flagged.
6. Backend in English, front-end text in French. Keep the repo conventions (Elysia module with
   `index.ts` / `service.ts` / `model.ts`, Drizzle for simple queries and `sql` templates for
   aggregates, migrations through drizzle-kit, Vitest tests, OpenAPI detail on routes).

## Tokenisation (pure module, well tested)

Put it in `packages/core` (pure, no I/O), with a corpus of fixtures:

- Lowercase, strip accents for the *key* (keep a display form), split on non-letters, keep
  apostrophe/hyphen compounds sensibly (`l'ordre`, `blocus-éclair`).
- French stop-word list (articles, prepositions, auxiliaries, generic news filler like
  `selon`, `afin`, `ainsi`) **plus a domain stop list** (outlet names, "Lire aussi", cookie/consent
  lines, share-button text, dates, numbers). Make both lists data files, not code.
- Light normalisation instead of full stemming: plural/feminine folding and a small lemma map for
  the terms we track. Do not pull a heavy NLP dependency; justify any dependency you add.
- **Bigrams** (and trigrams for a short whitelist) for phrases like `forces de l'ordre`,
  `chaîne humaine`, `dégradations`, with a PMI/frequency threshold so we keep only meaningful
  ones.
- A **tracked-lexicon** file (data, editable by staff later): groups such as
  *mobilisation* (blocage, piquet, assemblée générale, grève), *incidents* (violences, heurts,
  gaz lacrymogène, interpellations), *demands* (revendications, réforme, abrogation),
  *actors* (CRS, proviseur, rectorat, syndicats, parents d'élèves, élèves/lycéens/étudiants),
  *framing* (émeutiers vs lycéens mobilisés, jeunes, casseurs). Counts for the lexicon are stored
  even when a term would otherwise be pruned.

## Metrics to ship (all SQL, no AI)

1. Top terms and top bigrams per period, per outlet, and national, with a **distinctiveness score**
   (log-odds or TF-IDF against the all-outlet baseline) so "what makes this outlet different" is
   visible and not just common words.
2. **Trend**: daily series for any term or lexicon group; spike detection (z-score vs trailing
   median) with a short list of "rising terms today".
3. **Framing contrast** across outlets using the lexicon groups (share of articles with
   incident vocabulary vs demand vocabulary vs mobilisation vocabulary).
4. **Coverage**: articles per outlet per day, full-text vs title-only share, relay share.
5. Term detail drawer: which outlets use it, daily curve, and links to a few source URLs (URLs
   only, stored already in `ingest_items`).
6. Keep the existing AI cards, but fed by a **sampled** sweep: lower `maxMediaCalls`, add a
   config `mediaSampleRate` or "only articles whose lexicon score is ambiguous", and show the AI
   badge only where a model result exists. Add a cost line to the AI usage page.

## Delivery plan

1. Short design note (table schema, size estimate, dedupe approach, idempotency, retention) and
   **ask me the open questions before coding** (vocabulary cap, retention, lexicon ownership,
   whether to backfill from existing `item_contents` still inside the retention window).
2. Migration + schema, tokeniser + tests, counting hook in the read stage + tests (idempotent
   re-run, merged duplicates, title-only items).
3. Query service + routes (cacheable, `s-maxage`), admin Medias UI with simple visuals (sparkline
   per term, bar of distinctive terms, outlet comparison matrix), sized for ~100 users.
4. A one-off backfill command (dry-run first) over `item_contents` still retained, never over
   anything deleted.
5. Benchmark: tokeniser throughput (articles/s) and added latency of the read stage; the page
   queries under 100 ms on a realistic volume (seed script).
6. Keep CI green at each step; small commits.

Be honest about limits: bag-of-words does not capture tone or negation ("pas de violences"), so
say where a metric can mislead and label it in the UI.
