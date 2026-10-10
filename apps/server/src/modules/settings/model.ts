import { t } from 'elysia'

export const SettingsModel = {
  public: t.Object({
    status_ttl_hours: t.Integer(),
    movement_start: t.String(),
    judge_tiers: t.Boolean(),
  }),
} as const
