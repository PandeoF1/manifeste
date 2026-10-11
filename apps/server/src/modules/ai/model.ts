import { t } from 'elysia'

export const AiModel = {
  days: t.Object({ days: t.Optional(t.Numeric({ minimum: 1, maximum: 366, default: 30 })) }),
  usage: t.Object({
    day: t.String(),
    task: t.String(),
    provider: t.String(),
    model: t.String(),
    calls: t.Number(),
    failures: t.Number(),
    promptTokens: t.Number(),
    outputTokens: t.Number(),
    thoughtsTokens: t.Number(),
    costUsd: t.Number(),
    avgLatencyMs: t.Number(),
  }),
  modelRef: t.Object({ provider: t.String(), model: t.String() }),
  status: t.Object({
    enabled: t.Boolean(),
    judge: t.Union([t.Literal('jev'), t.Literal('llm'), t.Literal('off')]),
    extractPrompt: t.String(),
    extractModels: t.Array(t.Object({ provider: t.String(), model: t.String() })),
    dailyBudgetUsd: t.Number(),
    spentTodayUsd: t.Number(),
  }),
}
