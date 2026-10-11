/**
 * The typed client of the Manifeste API (Eden Treaty): every route, body and response is checked
 * against the server's own types, so a change in the API breaks the build here, not in production.
 * Same origin in production (the API serves the site); in development Vite proxies /api.
 */
import { treaty } from '@elysiajs/eden'
import type { App } from '@manifeste/server'

export const origin =
  typeof window === 'undefined' ? 'http://localhost:3000' : window.location.origin

export const api = treaty<App>(origin, { fetch: { credentials: 'include' } })

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
  return data
}
