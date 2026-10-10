import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { SUBMIT_ERRORS, type SubmitErrorCode, type SubmitResponse } from '@shared/submission.ts'

export const nearbySchoolsQuery = (lat: number, lng: number) =>
  queryOptions({
    queryKey: ['schools', 'nearby', lat.toFixed(3), lng.toFixed(3)],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('nearby_schools', {
        p_lat: lat,
        p_lng: lng,
        p_radius_m: 2000,
      })
      if (error) throw error
      return data
    },
    staleTime: Infinity,
  })

export const searchSchoolsQuery = (q: string) =>
  queryOptions({
    queryKey: ['schools', 'search', q],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_schools', { p_query: q })
      if (error) throw error
      return data
    },
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

/** Sends the report to the submit-report Edge Function (multipart). */
export async function submitReport(form: FormData): Promise<void> {
  let res: Response
  try {
    res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/submit-report`, {
      method: 'POST',
      headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
      body: form,
    })
  } catch {
    throw new SubmitError('network', 'Pas de connexion. Vérifie ton réseau et réessaie.')
  }
  const body = (await res.json().catch(() => null)) as SubmitResponse | null
  if (body?.ok) return
  const code = body && !body.ok ? body.error : 'server_error'
  throw new SubmitError(code, SUBMIT_ERRORS[code] ?? SUBMIT_ERRORS.server_error)
}
