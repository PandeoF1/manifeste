import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { queryKeys } from '@/lib/queryKeys'
import type { Tables, Views } from '@/lib/database.types'
import { periodSince, type Period, type PublicSettings } from '@/lib/periods'

export type SchoolStatus = Views<'school_current_status'> & {
  /** Past periods: number of days with a blocked or filtering signal. */
  signal_days?: number
  /** Judge tiers: a mere reported mobilisation (added by the app to lists, never by the database). */
  mobilisation?: boolean
}
export type PublicReport = Pick<
  Tables<'reports'>,
  | 'id'
  | 'status'
  | 'source_type'
  | 'source_url'
  | 'source_domain'
  | 'observed_at'
  | 'photo_public_path'
>

const REFRESH_MS = 60_000

/**
 * List served by Vercel with a 30 s cache (less latency, less load on the database).
 * Any unexpected response (route missing in development, outage): the database is queried.
 */
async function fetchViaEdge(): Promise<SchoolStatus[] | null> {
  try {
    const res = await fetch('/api/statuses', { headers: { accept: 'application/json' } })
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return null
    const data: unknown = await res.json()
    return Array.isArray(data) ? (data as SchoolStatus[]) : null
  } catch {
    return null
  }
}

async function fetchCurrentStatuses(): Promise<SchoolStatus[]> {
  const cached = await fetchViaEdge()
  if (cached) return cached
  const { data, error } = await supabase
    .from('school_current_status')
    .select('*')
    .order('last_signal_at', { ascending: false })
  if (error) throw error
  return data
}

/**
 * Reported mobilisations where the text does not say "blocked" or "closed" (gathering, incident, unclear
 * case). Empty while judge tiers are off; only requested when they are on.
 */
async function mobilisationFetch(): Promise<SchoolStatus[]> {
  const { data, error } = await supabase
    .from('school_mobilisation_status')
    .select('*')
    .order('last_signal_at', { ascending: false })
  if (error) throw error
  return data.map((s) => ({ ...s, mobilisation: true }))
}

export const mobilisationQuery = queryOptions({
  queryKey: [...queryKeys.statuses.all, 'mobilisation'],
  queryFn: mobilisationFetch,
  staleTime: REFRESH_MS,
  refetchInterval: REFRESH_MS,
})

/** Reported mobilisations over a period (live: the view; others: SQL function). */
export const periodMobilisationQuery = (period: Period, settings: PublicSettings) =>
  queryOptions<SchoolStatus[], Error, SchoolStatus[], readonly unknown[]>(
    period === 'direct'
      ? {
          queryKey: [...mobilisationQuery.queryKey],
          queryFn: mobilisationFetch,
          staleTime: REFRESH_MS,
          refetchInterval: REFRESH_MS,
        }
      : {
          queryKey: [...queryKeys.statuses.all, 'mobilisation', period, settings.movementStart],
          queryFn: async () => {
            const { data, error } = await supabase.rpc('school_mobilisation_since', {
              p_since: periodSince(period, settings).toISOString(),
            })
            if (error) throw error
            return data.map((s) => ({ ...s, mobilisation: true }))
          },
          staleTime: REFRESH_MS,
          refetchInterval: REFRESH_MS,
        },
  )

export const statusesQuery = queryOptions({
  queryKey: queryKeys.statuses.list(),
  queryFn: fetchCurrentStatuses,
  staleTime: REFRESH_MS,
  // Polling is suspended when the tab is hidden (default behaviour).
  refetchInterval: REFRESH_MS,
})

/**
 * Mobilised schools over a period. Live reuses the map's view (and cache);
 * past periods aggregate the validated signals since their start.
 */
export const periodStatusesQuery = (period: Period, settings: PublicSettings) =>
  queryOptions<SchoolStatus[], Error, SchoolStatus[], readonly unknown[]>(
    period === 'direct'
      ? {
          queryKey: queryKeys.statuses.list(),
          queryFn: fetchCurrentStatuses,
          staleTime: REFRESH_MS,
          refetchInterval: REFRESH_MS,
        }
      : {
          queryKey: queryKeys.statuses.period(period, settings.movementStart),
          queryFn: async () => {
            const { data, error } = await supabase.rpc('school_status_since', {
              p_since: periodSince(period, settings).toISOString(),
            })
            if (error) throw error
            return data
          },
          staleTime: REFRESH_MS,
          refetchInterval: REFRESH_MS * 2,
        },
  )

export const schoolReportsQuery = (uai: string) =>
  queryOptions({
    queryKey: queryKeys.schoolReports(uai),
    queryFn: async (): Promise<PublicReport[]> => {
      const since = new Date(Date.now() - 24 * 3_600_000).toISOString()
      const { data, error } = await supabase
        .from('reports')
        .select(
          'id, status, source_type, source_url, source_domain, observed_at, photo_public_path',
        )
        .eq('school_uai', uai)
        .eq('moderation', 'validated')
        .gte('observed_at', since)
        .order('observed_at', { ascending: false })
        .limit(20)
      if (error) throw error
      return data
    },
    staleTime: REFRESH_MS,
  })

export { computeStats, type NationalStats } from './stats'
