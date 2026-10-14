# Benchmarks

Every change to the parser, a prompt or a model is judged by numbers on labelled data, not by
feeling. Each benchmark runs **offline** (saved inputs, deterministic, free) and, where it makes
sense, **live** (real network or model calls, with a cost cap). Results are JSON files under
`results/` and can be compared run to run.

## Parser

Compares ways of turning a press page's HTML into text, a title and a publication date.

```bash
cd bench
bun run corpus:pull                    # once: fetch the saved pages (see "Corpus")
bun parser/run.ts --variants legacy,branch,v2 --labelled
bun parser/run.ts --variants v2 --limit 200 --details   # quick run, per-page details
```

Variants live in `parser/variants/`:

| Variant  | What it is                                                          |
| -------- | ------------------------------------------------------------------- |
| `legacy` | The parser of the Supabase version, frozen (regexes over the HTML). |
| `branch` | The `dev/better-html-parser` experiment, frozen (DOM + blocklists). |
| `v2`     | `packages/parser`, the one the new ingestion pipeline uses.         |

Adding a variant means one file implementing `ParserVariant` and one line in `variants/index.ts`.

### Datasets (`datasets/parser/`)

| File                    | Content                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `mentions.jsonl`        | 2,705 (page, school) pairs: the school the judge confirmed the article is about.          |
| `publication-dates.csv` | 283 publication dates read by a human, 195 with a cached page.                            |
| (computed)              | Boilerplate reference: lines repeated across a site's pages are page furniture, not text. |

### Metrics

- **Mention recall**: the share of labelled schools still found in the text handed to the AI,
  within its first 6,000 characters (what the model actually reads) and over the whole text.
  This is the metric that matters most: text lost here is a report lost.
- **Date found / same day / within 1 h** against the human labels.
- **Boilerplate share**: share of the output made of furniture lines.
- Median length, empty outputs, latency p50/p95, and how many pages were flagged as blocked.

### Latest results (labelled run, 1,384 pages)

| Metric                              | legacy    | branch    | v2       |
| ----------------------------------- | --------- | --------- | -------- |
| mention recall, first 6,000 chars % | 94.5      | 87.9      | 96.0     |
| mention recall, whole text %        | 94.5      | 87.9      | 97.9     |
| date found %                        | 95.9      | 95.9      | 96.9     |
| date same day %                     | 94.4      | 94.4      | 95.4     |
| boilerplate %                       | 6.2       | 5.7       | 5.7      |
| empty (< 200 chars) %               | 0.7       | 0.3       | 0.1      |
| latency p50 / p95 (ms)              | 0.4 / 1.3 | 2.9 / 8.4 | 6.3 / 21 |

The 340 pages `v2` flags as blocked are real: paywalls (131), Google News stubs and
client-rendered pages with no text (189), challenge pages (2). They were previously fed to the
AI as if they were articles.

## AI: judge and extraction

Compares judges (Jev, general LLMs) and extraction prompts/models on **223 hand-labelled
reports** (`datasets/ai/reports.jsonl`: the article, the school and status the pipeline claimed,
and a human verdict `yes | no | unsure`; the 55 `unsure` ones are left out). Labels come from the
manual audit of 200 published reports and the judge sample; `ai/build-datasets.ts` documents the
conversion. Articles are read from the saved corpus with the parser under test, so a better
parser also moves these numbers; reports without a saved page are counted, not hidden.

```bash
cd bench
bun ai/run.ts --task judge   --variants jev-recorded                  # frozen Jev answers, free
bun ai/run.ts --task judge   --variants jev,llm:gemini:gemini-3.5-flash,llm:anthropic:claude-haiku-5-5 --live
bun ai/run.ts --task extract --variants v1@gemini:gemini-3.5-flash-lite,v1-strict@gemini:gemini-3.5-flash-lite --live
bun ai/run.ts --task extract --variants v1@gemini:gemini-3.5-flash-lite   # replays what --live recorded
```

- **Offline** (default): every HTTP exchange comes from a recording, so a run is free, fast and
  deterministic, and the adapters' real code runs. A request with no recording is unanswered and
  the `cases answered` row says so.
- **`--live`**: real API calls (keys from `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `JEV_API_KEY`,
  `OPENAI_BASE_URL` + `OPENAI_API_KEY`), every exchange recorded, and a hard stop at `--max-usd`
  (default 1) of estimated spend. Each variant is a chain of one model: a fallback would blur the
  comparison. Use `--rpm` to stay under a free-tier rate limit.
- Recordings hold article text, so they live in `<corpus>/recordings/` (synced with the corpus by
  `corpus:push|pull`), never in git. Summaries (no article text) go to `results/ai/`.

Metrics. Judge: **AUC** (chance that a true report outranks a false one, threshold-free), the best
threshold that keeps ≥ 95 % of true reports and how many false ones it drops, and how often the
judge calls a false report a "blockade". Extraction: true reports kept (must not drop), false
reports kept (must drop), status correct among kept; plus cost and latency per variant.

The decision rule for changing the production model or prompt is in `docs/ai.md`.

## Corpus

Raw press HTML is copyrighted and large, so it is **not in git**. The 1,951 saved pages live in
a private Cloudflare R2 bucket (`manifeste-corpus`) as `cache/<sha256(url)>.html` plus `urls.json`.

```bash
export R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com
export R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=…
bun run corpus:pull   # to ~/manifest-corpus (or CORPUS_DIR)
bun run corpus:push   # after adding pages
```

The labels (hashes, sentences, dates) are small and are in git, so the benchmark is reproducible
by anyone with the bucket.

## Source judge

`datasets/source/` holds the samples used to compare judge settings (see
`compare-judge-report.md`). It will move under the same harness as the AI benchmarks in phase 4.

## Reading and storing results

`results/parser/<timestamp>.json` holds every run's summary (variants, metrics, dataset sizes).
Commit the runs you want to cite; per-page details (`*-pages.jsonl`) stay local.
