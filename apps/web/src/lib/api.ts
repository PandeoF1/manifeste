/**
 * The typed client of the Manifeste API (Eden Treaty): every route, body and response is checked
 * against the server's own types, so a change in the API breaks the build here, not in production.
 * Same origin in production (the API serves the site); in development Vite proxies /api.
 */
import { treaty } from '@elysiajs/eden'
import type { App } from '@manifeste/server'

export const origin =
  typeof window === 'undefined' ? 'http://localhost:3000' : window.location.origin

// Eden would turn every date-looking string into a Date, "2026-09-14" included, which breaks the
// fields the API declares as plain strings (a setting, a day). Dates are revived here instead,
// and only the full timestamps the server writes for its Date fields.
export const api = treaty<App>(origin, { fetch: { credentials: 'include' }, parseDate: false })

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

/** Deep copy with ISO timestamps turned into Dates. */
export function reviveDates<T>(value: T): T {
  if (typeof value === 'string') {
    if (!TIMESTAMP.test(value)) return value
    const date = new Date(value)
    return (Number.isNaN(date.getTime()) ? value : date) as T
  }
  if (Array.isArray(value)) return value.map(reviveDates) as T
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, reviveDates(v)])) as T
  return value
}

/** The `data` of a response, or the error thrown for TanStack Query to handle. */
export async function unwrap<T>(
  call: Promise<{ data: T | null; error: { status: unknown; value: unknown } | null }>,
): Promise<T> {
  const { data, error } = await call
  if (error || data === null) {
    const detail =
      error && typeof error.value === 'string' ? error.value : `HTTP ${String(error?.status)}`
    throw new Error(detail)
  }
  return reviveDates(data)
}

/** For calls with no body in the answer (204): throws the server's message on failure. */
export async function expectOk(
  call: Promise<{ error: { status: unknown; value: unknown } | null }>,
): Promise<void> {
  const { error } = await call
  if (error)
    throw new Error(typeof error.value === 'string' ? error.value : `HTTP ${String(error.status)}`)
}
