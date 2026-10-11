import { t, Elysia } from 'elysia'
import type { Ai } from '@manifeste/ai'
import type { Auth } from '../../auth/auth.ts'
import { authPlugin } from '../../auth/plugin.ts'
import { AiModel } from './model.ts'
import type { AiUsageService } from './service.ts'

/** What the AI costs and which models serve which task (admins). Settings are read-only here. */
export const aiModule = (auth: Auth, ai: Ai, usage: AiUsageService) =>
  new Elysia({ name: 'module.ai', prefix: '/api/staff/ai' })
    .use(authPlugin(auth))
    .get(
      '/status',
      async () => ({
        enabled: ai.config.enabled,
        judge: ai.config.tasks.judge.kind,
        extractPrompt: ai.config.tasks.extract.prompt,
        extractModels: ai.config.tasks.extract.models.map((m) => ({
          provider: m.provider,
          model: m.model,
        })),
        dailyBudgetUsd: ai.config.budget.dailyUsd,
        spentTodayUsd: Number((await usage.spentToday()).toFixed(4)),
      }),
      {
        staff: { ai: ['view'] },
        response: { 200: AiModel.status },
        detail: { tags: ['staff'], summary: 'AI switches, models, budget and spend today' },
      },
    )
    .get('/usage', ({ query }) => usage.usage(query.days ?? 30), {
      staff: { ai: ['view'] },
      query: AiModel.days,
      response: { 200: t.Array(AiModel.usage) },
      detail: {
        tags: ['staff'],
        summary: 'Calls, tokens and estimated cost per day, task and model',
      },
    })
