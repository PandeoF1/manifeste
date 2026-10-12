import { t } from 'elysia'

const check = t.Object({
  ok: t.Boolean(),
  latencyMs: t.Optional(t.Number()),
  detail: t.Optional(t.String()),
})

export const HealthModel = {
  live: t.Object({ status: t.Literal('ok'), role: t.String(), version: t.String() }),
  ready: t.Object({
    status: t.Union([t.Literal('ready'), t.Literal('not_ready')]),
    role: t.String(),
    version: t.String(),
    checks: t.Object({ database: check, migrations: check, queue: check, photos: check }),
    /**
     * Checks that fail without taking the site down (the photos): `status` stays `ready` and the
     * probe answers 200, so the orchestrator keeps routing; an uptime monitor can alert on this.
     */
    degraded: t.Array(t.String()),
  }),
} as const

export type Readiness = typeof HealthModel.ready.static
export type Check = typeof check.static
