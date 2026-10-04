// Edge Function : collecte automatique des sources (Telegram, RSS, Bluesky) + extraction IA.
// Déclenchée par pg_cron (en-tête x-collect-secret) ou par un admin connecté (bouton "Lancer").
import { createClient } from '@supabase/supabase-js'
import { collectAll, type CollectorDb, type CollectorSource } from '../_shared/collector.ts'
import { CERTAINTIES, type Certainty } from '../_shared/extraction.ts'
import { DEFAULT_GEMINI_MODEL, extractEvents } from '../_shared/gemini.ts'
import type { SchoolCandidate } from '../_shared/matching.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const COLLECT_SECRET = Deno.env.get('COLLECT_SECRET') ?? ''
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL
const MIN_CERTAINTY_RAW = Deno.env.get('COLLECT_MIN_CERTAINTY') ?? 'moyenne'
const MIN_CERTAINTY: Certainty = (CERTAINTIES as readonly string[]).includes(MIN_CERTAINTY_RAW)
  ? (MIN_CERTAINTY_RAW as Certainty)
  : 'moyenne'

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json; charset=utf-8' },
  })
}

function timingSafeEqual(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function isAuthorized(req: Request): Promise<boolean> {
  if (timingSafeEqual(req.headers.get('x-collect-secret') ?? '', COLLECT_SECRET)) return true
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return false
  const { data } = await admin.auth.getUser(token)
  return data.user?.app_metadata?.role === 'admin'
}

const db: CollectorDb = {
  async seenIds(sourceId, externalIds) {
    if (externalIds.length === 0) return new Set()
    const { data, error } = await admin
      .from('scraped_items')
      .select('external_id')
      .eq('source_id', sourceId)
      .in('external_id', externalIds)
    if (error) throw new Error(`scraped_items: ${error.message}`)
    return new Set(data.map((r) => r.external_id as string))
  },
  async markSeen(sourceId, externalIds) {
    if (externalIds.length === 0) return
    const { error } = await admin.from('scraped_items').upsert(
      externalIds.map((external_id) => ({ source_id: sourceId, external_id })),
      { onConflict: 'source_id,external_id', ignoreDuplicates: true },
    )
    if (error) throw new Error(`scraped_items: ${error.message}`)
  },
  async matchSchool(name, city) {
    const { data, error } = await admin.rpc('match_school', {
      p_name: name,
      p_city: city,
      p_limit: 5,
    })
    if (error) throw new Error(`match_school: ${error.message}`)
    return (data ?? []) as SchoolCandidate[]
  },
  async insertReport(report) {
    const { error } = await admin.from('reports').insert(report)
    if (!error) return 'inserted'
    if (error.code === '23505') return 'duplicate'
    throw new Error(`reports: ${error.message}`)
  },
  async insertUnmatched(row) {
    const { error } = await admin.from('unmatched_extractions').insert(row)
    if (error) throw new Error(`unmatched_extractions: ${error.message}`)
  },
  async recordRun(sourceId, err) {
    await admin
      .from('scrape_sources')
      .update({ last_run_at: new Date().toISOString(), last_error: err })
      .eq('id', sourceId)
  },
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  if (!(await isAuthorized(req))) return json(401, { error: 'unauthorized' })
  if (!GEMINI_API_KEY) return json(500, { error: 'missing_gemini_api_key' })

  let sourceId: string | null = null
  try {
    const body = (await req.json().catch(() => ({}))) as { source_id?: unknown }
    if (typeof body.source_id === 'string') sourceId = body.source_id
  } catch {
    // corps vide accepté
  }

  let query = admin
    .from('scrape_sources')
    .select('id, kind, identifier, label, source_type')
    .eq('enabled', true)
    .order('last_run_at', { ascending: true, nullsFirst: true })
  if (sourceId) query = query.eq('id', sourceId)
  const { data: sources, error } = await query
  if (error) return json(500, { error: 'sources_unavailable', detail: error.message })

  const startedAt = Date.now()
  const results = await collectAll((sources ?? []) as CollectorSource[], {
    db,
    fetchFn: fetch,
    minCertainty: MIN_CERTAINTY,
    extract: (batch) =>
      extractEvents({ apiKey: GEMINI_API_KEY, model: GEMINI_MODEL, fetchFn: fetch }, batch),
  })

  return json(200, { model: GEMINI_MODEL, duration_ms: Date.now() - startedAt, results })
})
