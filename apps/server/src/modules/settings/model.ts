import { t } from 'elysia'

export const SettingsModel = {
  public: t.Object({
    status_ttl_hours: t.Integer(),
    movement_start: t.String(),
    judge_tiers: t.Boolean(),
    movements_public: t.Boolean(),
    marches_on_map: t.Boolean(),
  }),
} as const
