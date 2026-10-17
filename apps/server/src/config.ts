/**
 * Process configuration, read once from the environment and validated at boot:
 * a missing or malformed variable stops the process with a readable message.
 * Only deployment facts and secrets live here. AI models and prompts are the defaults of
 * `@manifeste/ai` (config.ts), overridable by the optional AI_* / GEMINI_* variables below.
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
  /** Content-Security-Policy of the pages: `enforce` (default), `report-only` (log, do not block) or `off`. */
  CSP_MODE: t.Union([t.Literal('enforce'), t.Literal('report-only'), t.Literal('off')], {
    default: 'enforce',
  }),
  /** Origins the map loads from, comma separated (the CSP allows them). Must match VITE_MAP_STYLE_URL. */
  CSP_MAP_ORIGINS: t.String({ default: 'https://tiles.openfreemap.org' }),
  /**
   * Who must have TOTP enabled before reaching staff routes: `admin` (default), `all` staff, or
   * `none` to disable the 2FA requirement.
   * Moderators see the original photos of reports (minors included), so `all` is advised once
   * every moderator has enrolled.
   */
  STAFF_2FA: t.Union([t.Literal('admin'), t.Literal('all'), t.Literal('none')], { default: 'admin' }),
  /** Run migrations at boot. On for dev, staging and previews; production runs a one-shot migrate step. */
  MIGRATE_ON_BOOT: t.Boolean({ default: false }),
  /** Public origin, used for auth callbacks and absolute links (no trailing slash). */
  PUBLIC_URL: t.String({ pattern: '^https?://[^/]+$', default: 'http://localhost:3000' }),
  /** Signs session cookies. `openssl rand -hex 32`. */
  AUTH_SECRET: t.String({ minLength: 32 }),
  /** Built SPA served by the API (one origin). Empty disables static serving (tests). */
  WEB_DIST: t.String({ default: '../web/dist' }),
  /** Where photos are stored: `fs` (a volume shared by the api and the worker) or `s3` (R2, MinIO…). */
  BLOB_STORE: t.Union([t.Literal('fs'), t.Literal('s3')], { default: 'fs' }),
  /** `fs`: the folder of the volume. */
  DATA_DIR: t.String({ default: './data' }),
  /** `s3`: bucket and credentials. The bucket must not be public. */
  S3_BUCKET: t.Optional(t.String()),
  S3_ACCESS_KEY_ID: t.Optional(t.String()),
  S3_SECRET_ACCESS_KEY: t.Optional(t.String()),
  /** `https://<account>.r2.cloudflarestorage.com` for R2, `http://minio:9000` for MinIO; unset for AWS. */
  S3_ENDPOINT: t.Optional(t.String({ pattern: '^https?://' })),
  /** `auto` for R2. */
  S3_REGION: t.String({ default: 'auto' }),
  /** Prepended to every key, to share a bucket between environments (`prod/`). */
  S3_PREFIX: t.Optional(t.String()),
  /** Bucket in the host name instead of the path (AWS style). R2 and MinIO: leave off. */
  S3_VIRTUAL_HOSTED: t.Boolean({ default: false }),
  /** The resvg WebAssembly file (the image ships it next to the bundle); default: from node_modules. */
  RESVG_WASM: t.Optional(t.String()),
  /** Cloudflare Turnstile secret. Without it the check is skipped only outside production. */
  TURNSTILE_SECRET_KEY: t.Optional(t.String()),
  /** AI. Without a key the AI is switched off outside production (and fails the boot in a worker in production). */
  GEMINI_API_KEY: t.Optional(t.String()),
  GEMINI_MODEL: t.Optional(t.String()),
  /** Comma separated, tried in order when the primary model is saturated or out of quota. */
  GEMINI_FALLBACK_MODELS: t.Optional(t.String()),
  GEMINI_THINKING_BUDGET: t.Optional(t.String()),
  GEMINI_TEXT_CHARS: t.Optional(t.String()),
  /** Extraction prompt version (v1, v1-strict, v1-nature, v1-strict-nature). */
  GEMINI_PROMPT: t.Optional(t.String()),
  ANTHROPIC_API_KEY: t.Optional(t.String()),
  JEV_API_KEY: t.Optional(t.String()),
  JEV_MODEL: t.Optional(t.String()),
  /** `off` disables the judge. */
  AI_JUDGE: t.Optional(t.String()),
  /** Kill switch: `false` refuses every AI call. */
  AI_ENABLED: t.Optional(t.String()),
  /** Estimated USD per UTC day above which AI calls are refused (0 = no cap). */
  AI_DAILY_BUDGET_USD: t.Optional(t.String()),
  /** Run the ingestion pipeline in this worker. Off lets a staging copy share a database without double-reading sources. */
  INGEST_ENABLED: t.Boolean({ default: true }),
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
  // Behind Cloudflare the domain is declared as http:// in Coolify (the proxy ends TLS), but visitors
  // use https: in production the origin must be https or sign-in refuses it (INVALID_ORIGIN).
  const coolifyUrl = env.COOLIFY_URL?.split(',')[0]?.trim().replace(/\/$/, '')
  if (coolifyUrl && !env.PUBLIC_URL)
    raw.PUBLIC_URL =
      env.NODE_ENV === 'production' ? coolifyUrl.replace(/^http:/, 'https:') : coolifyUrl
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
  if (value.BLOB_STORE === 's3') {
    const missing = ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'].filter(
      (k) => !(value as Record<string, unknown>)[k],
    )
    if (missing.length > 0)
      throw new ConfigError(`Invalid environment:\n  BLOB_STORE=s3 needs ${missing.join(', ')}`)
  }
  return value
}
