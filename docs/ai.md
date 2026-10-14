# AI layer

All AI code lives in `packages/ai` (`@manifeste/ai`). It does no I/O of its own (`fetch` is
injected), so the server, the worker and the benchmarks run the very same code.

## Shape

```
tasks (extract, judge, reanalyse, media)      what we ask, strict validation of the answer
  └─ chain  (retry / fallback / sticky)       how a failure is handled, per task
       └─ JsonModel port                      one provider + one model
            ├─ gemini            Gemini generateContent, structured output
            ├─ openai-compatible OpenAI, OpenRouter, Mistral, Groq, vLLM, Ollama…
            ├─ anthropic         Messages API, forced tool call as structured output
            └─ replay            recorded answers (tests, benchmarks)
Judge port ── jev (TypeSafe)  |  llm (any JsonModel answers the same questions)
```

Output schemas are TypeBox schemas, so one definition is the JSON Schema sent to the provider,
the TypeScript type and the validator. A model's answer is never trusted: events that do not
validate are dropped, an UAI that was not offered is rejected, a quote that is not in the article
is removed.

## Configuration

One validated object, `AiConfig` (`packages/ai/src/config.ts`), checked at boot. Defaults are
production's behaviour: Gemini Flash-Lite first, three Flash fallbacks, Jev as the judge.
Environment variables only override (see `.env.example`): keys, `GEMINI_MODEL`,
`GEMINI_FALLBACK_MODELS`, `GEMINI_THINKING_BUDGET`, `GEMINI_PROMPT`, `AI_ENABLED`,
`AI_DAILY_BUDGET_USD`, `AI_JUDGE`.

- A model whose provider has no credentials fails the boot (a worker in production), not the
  third call of a night run. Without a Gemini key outside production, AI is simply off.
- **Kill switch**: `AI_ENABLED=false` makes every call fail fast with kind `disabled`.
- **Budget**: `AI_DAILY_BUDGET_USD` refuses calls once the estimated spend of the UTC day is
  reached (kind `budget`). Spend is estimated from list prices (`pricing.ts`, overridable in the
  config), never from a bill.
- Moving a task to another provider is a config change: `tasks.extract.models = [{ provider:
'anthropic', model: 'claude-haiku-5-5' }]`. A new provider is one adapter file implementing
  `JsonModel`.

## Failure policy (the chain)

| Error                                 | What happens                                                |
| ------------------------------------- | ----------------------------------------------------------- |
| 5xx, timeout, network                 | retry the same model (`retriesPerModel`), then the next one |
| 429 quota, 404 model closed           | next model at once: a quota does not free up in two seconds |
| the answer is not JSON                | next model                                                  |
| 402 billing, 401/403 key, 400 refused | stop: no other model will do better                         |

The chain is sticky for the length of a run: once a model answers, later calls start with it
instead of retrying a saturated one. Every call, failed ones included, goes to the usage sink.

## Accounting

Calls are counted in memory per (task, provider, model, prompt version) and flushed every 30 s
(and on shutdown) to hourly `ai_usage` rows. `GET /api/staff/ai/status` and `/usage?days=N`
(admins) expose switches, models, spend today and per-day calls, tokens, cost and latency.
Individual calls are traces, not rows.

## Prompts

Versioned in `src/prompts/<task>.ts` and kept in French on purpose: they instruct a model about
French press and school vocabulary, and the wording was tuned on labelled data. The model's
answer uses the vocabulary the prompt defines ("bloque", "haute"…); the task maps it to the
English domain values, so nothing French leaks past the task boundary.

Rules:

1. **Never edit a published version.** Add `v2` (or a named variant), benchmark it, then switch
   `tasks.extract.prompt`. The prompt version is stored with every usage row, so a cost or
   quality change can be traced to the change that caused it.
2. A prompt change is judged on the golden reports, not on a handful of examples.

## Benchmarks and the decision rule

`bench/` holds the golden dataset (223 hand-labelled reports) and the runner, see
`bench/README.md`. To change the production model, prompt or judge:

1. Run the candidate and the current setup with `--live` on the same cases, recording them.
2. The candidate may replace the current setup only if all of these hold:
   - **extraction**: it keeps at least as many true reports (never lose a real blockade for a
     cleaner map), and keeps clearly fewer false ones;
   - **judge**: higher AUC, or equal AUC at a materially lower cost;
   - cost per 1,000 reports and latency are acceptable (the collection runs every 10 minutes
     and the free Gemini quota is 15 requests a minute for Flash-Lite).
3. Commit the `results/ai/*.json` summary that justifies the change and cite it in the commit.

Reference numbers (offline, frozen Jev answers from when the sample was built): AUC 0.871 on
52 labelled reports. No live comparison of other models has been run yet: it needs API keys and
is the first thing to do before a model change. `docs/ai-model-review.md` is the place to record
it.

## Trusting the model's answer

A call handles many articles and its answer creates public reports, so the answer is checked
rather than believed:

- **Attribution.** An event is kept only if the school it names appears in the text of the item it
  is attached to (`eventNamedInText`: half of the distinctive words of the cited name, or the city
  for a name made of the city alone). Otherwise the fact is dropped as `low_certainty` with the
  detail "the school is not named in the article text". Map points (position) and a staff choice
  are exempt. Without this a model that mixed two articles up, or obeyed a sentence hidden in
  one, could publish a school the article never mentions, with the trust of that article's source.
- **Untrusted text.** The user message starts with a notice that the texts are data, not orders,
  and each event may only concern the message whose id it gives. The "Carte « … »" header that
  the prompt reads as a map point is defused in every item that is not a real map point.
- **Small calls.** 15 items per call (12 calls per run), not 50: a confusing article reaches fewer
  others, and the answer is capped (`maxOutputTokens`, 2,048 + 400 per item) so that it is not cut.
- **Unusable answers are not "no fact".** Events that are malformed or about an item that was not
  sent are counted (`dropped`). An item whose answer held only such events is asked again (up to
  `maxAttempts`) instead of being closed as `no_event`.
- **Unjudged reports.** A report without a second opinion counts as confirmed until judged, so
  a `rejudge` of the last 48 hours runs every 30 minutes (60 reports at most) instead of
  waiting for someone to start it.

The system prompts themselves are unchanged (they are versioned and measured). Changing the
size of the calls and adding the notice does change what the model sees: run `bench/ai` on the
labelled sample after deploying to compare with the previous figures.
