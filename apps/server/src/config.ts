/**
 * Process configuration, read once from the environment and validated at boot:
 * a missing or malformed variable stops the process with a readable message.
 * Only deployment facts and secrets live here. AI providers and models live in ai.config.ts (phase 4).
 */
import { type Static, Type as t } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

export const ROLES = ['api', 'worker', 'all'] as const
export type Role = (typeof ROLES)[number]

const Env = t.Object({
  NODE_ENV: t.Union([t.Literal('development'), t.Literal('test'), t.Literal('production')], {
    default: 'development',
  }),
  /** api: HTTP + WebSocket. worker: jobs. all: both in one process (dev, staging, previews). */
  ROLE: t.Union(
    ROLES.map((r) => t.Literal(r)),
    { default: 'all' },
  ),
  PORT: t.Integer({ minimum: 1, maximum: 65535, default: 3000 }),
  DATABASE_URL: t.String({ pattern: '^postgres(ql)?://' }),
  DATABASE_POOL_MAX: t.Integer({ minimum: 1, default: 10 }),
  /** Run migrations at boot. On for dev, staging and previews; production runs a one-shot migrate step. */
  MIGRATE_ON_BOOT: t.Boolean({ default: false }),
  /** Public origin, used for auth callbacks and absolute links (no trailing slash). */
  PUBLIC_URL: t.String({ pattern: '^https?://[^/]+$', default: 'http://localhost:3000' }),
  /** Signs session cookies. `openssl rand -hex 32`. */
  AUTH_SECRET: t.String({ minLength: 32 }),
  /** Built SPA served by the API (one origin). Empty disables static serving (tests). */
  WEB_DIST: t.String({ default: '../web/dist' }),
  LOG_LEVEL: t.Union(
    ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'].map((l) => t.Literal(l)),
    { default: 'info' },
  ),
  /** Standard OTel variables; tracing export is off when the endpoint is unset. */
  OTEL_EXPORTER_OTLP_ENDPOINT: t.Optional(t.String()),
  OTEL_SERVICE_NAME: t.String({ default: 'manifeste' }),
})

export type Config = Static<typeof Env>

export class ConfigError extends Error {
  override name = 'ConfigError'
}

/** Parses and validates the environment. Empty strings count as unset. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const keys = Object.keys(Env.properties)
  const raw: Record<string, unknown> = {}
  // Coolify injects the resource URLs (comma separated): the first one is the public origin.
  const coolifyUrl = env.COOLIFY_URL?.split(',')[0]?.trim().replace(/\/$/, '')
  if (coolifyUrl && !env.PUBLIC_URL) raw.PUBLIC_URL = coolifyUrl
  for (const key of keys) {
    const value = env[key]
    if (value !== undefined && value !== '') raw[key] = value
  }
  const value = Value.Default(Env, Value.Convert(Env, raw))
  if (!Value.Check(Env, value)) {
    const problems = [...Value.Errors(Env, value)].map(
      (e) => `  ${e.path.slice(1) || '(root)'}: ${e.message}`,
    )
    throw new ConfigError(`Invalid environment:\n${[...new Set(problems)].join('\n')}`)
  }
  return value
}
