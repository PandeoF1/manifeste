import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { queryKeys } from '@/lib/queryKeys'
import type { Tables } from '@/lib/database.types'
export { isAdminSession, staffRole, type StaffRole } from '@/lib/staffRole'

export type ScrapeSource = Tables<'scrape_sources'>
export type TrustedDomain = Tables<'trusted_domains'>
export type Unmatched = Tables<'unmatched_extractions'>
export type PendingReport = Tables<'reports'> & {
  schools: { name: string; city: string } | null
  scrape_sources: { label: string } | null
  report_submissions: Pick<Tables<'report_submissions'>, 'photo_path' | 'distance_m'> | null
}

export const sessionQuery = queryOptions({
  queryKey: queryKeys.session,
  queryFn: async () => (await supabase.auth.getSession()).data.session,
  staleTime: Infinity,
})

export function useSession() {
  const queryClient = useQueryClient()
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      queryClient.setQueryData(queryKeys.session, session)
      if (!session) queryClient.removeQueries({ queryKey: queryKeys.admin.all })
    })
    return () => data.subscription.unsubscribe()
  }, [queryClient])
  return useQuery(sessionQuery)
}

export const sourcesQuery = queryOptions({
  queryKey: queryKeys.admin.sources(),
  queryFn: async (): Promise<ScrapeSource[]> => {
    const { data, error } = await supabase
      .from('scrape_sources')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw error
    return data
  },
})

export const pendingQuery = queryOptions({
  queryKey: queryKeys.admin.pending(),
  queryFn: async (): Promise<PendingReport[]> => {
    const { data, error } = await supabase
      .from('reports')
      .select(
        '*, schools(name, city), scrape_sources(label), report_submissions(photo_path, distance_m)',
      )
      .eq('moderation', 'pending')
      .order('observed_at', { ascending: false })
      .limit(200)
    if (error) throw error
    return data as PendingReport[]
  },
  refetchInterval: 60_000,
})

/** Row returned by moderator_pending_reports (no position, no internal source). */
interface ModeratorRow {
  id: string
  school_uai: string
  school_name: string | null
  school_city: string | null
  status: PendingReport['status']
  observed_at: string
  source_type: PendingReport['source_type']
  source_domain: string | null
  source_url: string | null
  source_label: string | null
  certainty: PendingReport['certainty']
  distance_m: number | null
  photo_path: string | null
  judge_score: number | null
  judge_nature: string | null
  judged_at: string | null
}

/** Moderator's queue: same fields as the admin's, without position or source details. */
export const moderatorPendingQuery = queryOptions({
  queryKey: queryKeys.admin.moderatorPending(),
  queryFn: async (): Promise<PendingReport[]> => {
    const { data, error } = await supabase.rpc('moderator_pending_reports')
    if (error) throw new Error(error.message)
    const rows = (Array.isArray(data) ? data : []) as unknown as ModeratorRow[]
    return rows.map(
      (r) =>
        ({
          id: r.id,
          school_uai: r.school_uai,
          status: r.status,
          observed_at: r.observed_at,
          source_type: r.source_type,
          source_domain: r.source_domain,
          source_url: r.source_url,
          certainty: r.certainty,
          judge_score: r.judge_score,
          judge_nature: r.judge_nature,
          judged_at: r.judged_at,
          schools: r.school_name ? { name: r.school_name, city: r.school_city ?? '' } : null,
          scrape_sources: r.source_label ? { label: r.source_label } : null,
          report_submissions:
            r.distance_m == null ? null : { photo_path: r.photo_path, distance_m: r.distance_m },
        }) as PendingReport,
    )
  },
  refetchInterval: 60_000,
})

/** Queue according to the role (same data shape; only the key type differs). */
export const pendingQueryFor = (moderator: boolean) =>
  (moderator ? moderatorPendingQuery : pendingQuery) as unknown as typeof pendingQuery

export const unmatchedQuery = queryOptions({
  queryKey: queryKeys.admin.unmatched(),
  queryFn: async (): Promise<Unmatched[]> => {
    const { data, error } = await supabase
      .from('unmatched_extractions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) throw error
    return data
  },
})

export const trustedDomainsQuery = queryOptions({
  queryKey: queryKeys.admin.trustedDomains(),
  queryFn: async (): Promise<TrustedDomain[]> => {
    const { data, error } = await supabase.from('trusted_domains').select('*').order('domain')
    if (error) throw error
    return data
  },
})

export interface CollectRunResult {
  model: string
  gemini_calls?: number
  /** Tokens of the run; thinking is billed as output. */
  tokens?: { prompt: number; output: number; thoughts: number }
  duration_ms: number
  results: Array<{
    source_id: string
    label: string
    fetched: number
    new_items: number
    relevant: number
    events: number
    reports: number
    duplicates: number
    unmatched: number
    low_certainty: number
    error: string | null
  }>
}

export async function runCollect(sourceId?: string): Promise<CollectRunResult> {
  const { data, error } = await supabase.functions.invoke<CollectRunResult>('collect', {
    body: sourceId ? { source_id: sourceId } : {},
  })
  if (error) throw error
  if (!data) throw new Error('Réponse vide')
  return data
}

/** Temporary URL (5 min) of an original photo, readable by staff only. */
export async function originalPhotoUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('submissions').createSignedUrl(path, 300)
  if (error) throw error
  return data.signedUrl
}

export type Decision = { kind: 'validate'; photo?: Blob } | { kind: 'reject' }

/**
 * Applies the staff decision. For a report with a photo:
 * - the blurred version (if published) goes to the public "photos" bucket;
 * - the original is deleted in every case.
 */
export async function moderate(report: PendingReport, decision: Decision): Promise<void> {
  let photoPublicPath: string | null = null
  if (decision.kind === 'validate' && decision.photo) {
    photoPublicPath = `${report.id}.jpg`
    // No "upsert": it requires read and update rights on the bucket, which staff
    // do not have (insert and delete only). The old version is removed, then the new one published.
    await supabase.storage.from('photos').remove([photoPublicPath])
    const { error } = await supabase.storage
      .from('photos')
      .upload(photoPublicPath, decision.photo, { contentType: 'image/jpeg' })
    if (error) throw error
  }
  const { error } = await supabase
    .from('reports')
    .update({
      moderation: decision.kind === 'validate' ? 'validated' : 'rejected',
      photo_public_path: photoPublicPath,
    })
    .eq('id', report.id)
  if (error) throw error

  const original = report.report_submissions?.photo_path
  if (original) {
    const { error: removeError } = await supabase.storage.from('submissions').remove([original])
    if (removeError) throw removeError
    await supabase
      .from('report_submissions')
      .update({ photo_path: null })
      .eq('report_id', report.id)
  }
}

/**
 * Validation by a moderator: the only allowed action. The blurred photo, if published, is
 * stored as <id>.jpg (no replace or delete: the database refuses it), then the
 * report is validated by a function that only accepts this "pending" to "validated" change.
 * The original is removed by the hourly purge.
 */
export async function approveAsModerator(report: PendingReport, photo?: Blob): Promise<void> {
  let photoPublicPath: string | null = null
  if (photo) {
    photoPublicPath = `${report.id}.jpg`
    const { error } = await supabase.storage
      .from('photos')
      .upload(photoPublicPath, photo, { contentType: 'image/jpeg' })
    if (error) throw new Error(`Photo : ${error.message}`)
  }
  const { error } = await supabase.rpc('moderator_approve_report', {
    p_id: report.id,
    p_photo_public_path: photoPublicPath,
  })
  if (error) throw new Error(error.message)
}

export interface ReanalyzeResult {
  model: string | null
  linked: number
  total: number
  outcomes: Array<{
    id: string
    school_name: string
    city: string | null
    result: string
    uai?: string
  }>
}

/** AI re-analysis (reanalyze Edge Function): all extractions, or a list. */
export async function reanalyze(ids?: string[]): Promise<ReanalyzeResult> {
  const { data, error } = await supabase.functions.invoke<ReanalyzeResult>('reanalyze', {
    body: ids ? { ids } : {},
  })
  if (error) throw error
  if (!data) throw new Error('Réponse vide')
  return data
}

export type AdminReport = Tables<'reports'> & {
  schools: { name: string; city: string } | null
  scrape_sources: { label: string } | null
}

/** All recent signals (published, pending, rejected), for the "Signals" tab. */
export const reportsQuery = queryOptions({
  queryKey: queryKeys.admin.reports(),
  queryFn: async (): Promise<AdminReport[]> => {
    const { data, error } = await supabase
      .from('reports')
      .select('*, schools(name, city), scrape_sources(label)')
      .order('observed_at', { ascending: false })
      .limit(300)
    if (error) throw error
    return data as AdminReport[]
  },
})

export interface ReportPatch {
  school_uai?: string
  status?: Tables<'reports'>['status']
  observed_at?: string
  moderation?: Tables<'reports'>['moderation']
}

export async function updateReport(id: string, patch: ReportPatch): Promise<void> {
  const { error } = await supabase.rpc('admin_update_report', {
    p_id: id,
    p_school_uai: patch.school_uai ?? null,
    p_status: patch.status ?? null,
    p_observed_at: patch.observed_at ?? null,
    p_moderation: patch.moderation ?? null,
  })
  if (error) throw new Error(error.message)
}

export async function deleteReport(report: AdminReport): Promise<void> {
  if (report.photo_public_path) {
    await supabase.storage.from('photos').remove([report.photo_public_path])
  }
  const { error } = await supabase.rpc('admin_delete_report', { p_id: report.id })
  if (error) throw new Error(error.message)
}

/** Sends the signal back to "Unmatched" then runs the AI re-analysis on it. */
export async function sendBackToAi(id: string): Promise<ReanalyzeResult> {
  const { data, error } = await supabase.rpc('admin_report_to_unmatched', { p_id: id })
  if (error) throw new Error(error.message)
  return reanalyze([data])
}

export type CollectorRun = Tables<'collector_runs'> & {
  collector_item_logs: Tables<'collector_item_logs'>[]
}

/** Latest runs of a source, with what became of each item (7 days max). */
export const sourceLogQuery = (sourceId: string) =>
  queryOptions({
    queryKey: [...queryKeys.admin.all, 'source-log', sourceId] as const,
    queryFn: async (): Promise<CollectorRun[]> => {
      const { data, error } = await supabase
        .from('collector_runs')
        .select('*, collector_item_logs(*)')
        .eq('source_id', sourceId)
        .order('ran_at', { ascending: false })
        .limit(30)
      if (error) throw error
      return data as CollectorRun[]
    },
  })
