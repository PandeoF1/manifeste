# AI model review

The question this page answers: **is Gemini Flash-Lite + Jev still the right setup?** The
default stays until a benchmark says otherwise (see the decision rule in `ai.md`).

## Status

- Baseline recorded: Jev, frozen answers, AUC 0.871 (52 reports with an article).
- **Not yet run live**: no API keys were available when the harness was built. The harness,
  datasets, recording and replay are in place and tested.

## How to produce the review

```bash
export GEMINI_API_KEY=… JEV_API_KEY=…
cd bench
bun ai/run.ts --task judge --live --max-usd 0.5 --rpm 12 \
  --variants jev-recorded,jev,llm:gemini:gemini-3.5-flash-lite,llm:gemini:gemini-3.5-flash
bun ai/run.ts --task extract --live --max-usd 2 --rpm 12 --thinking 0 \
  --variants v1@gemini:gemini-3.5-flash-lite,v1-strict@gemini:gemini-3.5-flash-lite,v1@gemini:gemini-3.5-flash,v1@anthropic:claude-haiku-5-5
```

Paste the two tables below with the date, then state the decision and the reason.

## Results

_Pending the first live run._

## Decision

Keep the production defaults (Flash-Lite with Flash fallbacks, Jev judge, prompt `v1`).
