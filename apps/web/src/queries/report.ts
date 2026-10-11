import { queryOptions } from '@tanstack/react-query'
import { SUBMIT_ERRORS, type SubmitError as SubmitErrorCode } from '@manifeste/core'
import { api, unwrap } from '@/lib/api'
import { SUBMIT_MESSAGES } from '@/lib/submitMessages'

export const nearbySchoolsQuery = (lat: number, lng: number) =>
  queryOptions({
    queryKey: ['schools', 'nearby', lat.toFixed(3), lng.toFixed(3)],
    queryFn: () => unwrap(api.api.schools.nearby.get({ query: { lat, lng, radiusM: 2000 } })),
    staleTime: Infinity,
  })

export const searchSchoolsQuery = (q: string) =>
  queryOptions({
    queryKey: ['schools', 'search', q],
    queryFn: () => unwrap(api.api.schools.search.get({ query: { q } })),
    staleTime: 10 * 60_000,
    enabled: q.trim().length >= 2,
  })

export class SubmitError extends Error {
  constructor(
    public code: SubmitErrorCode | 'network',
    message: string,
  ) {
    super(message)
  }
}

/** Sends the report (multipart) to the API. */
export async function submitReport(form: FormData): Promise<void> {
  let res: Response
  try {
    res = await fetch('/api/reports', { method: 'POST', body: form })
  } catch {
    throw new SubmitError('network', 'Pas de connexion. Vérifie ton réseau et réessaie.')
  }
  if (res.ok) return
  const body = (await res.json().catch(() => null)) as { error?: string } | null
  const code = (SUBMIT_ERRORS as readonly string[]).includes(body?.error ?? '')
    ? (body?.error as SubmitErrorCode)
    : 'server_error'
  throw new SubmitError(code, SUBMIT_MESSAGES[code])
}
