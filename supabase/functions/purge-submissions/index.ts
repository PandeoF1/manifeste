// Edge Function : supprime les photos originales des signalements non modérés après 48 h
// (et toute photo originale restée attachée à un signalement déjà traité).
// Déclenchée chaque heure par pg_cron (en-tête x-collect-secret).
import { createClient } from '@supabase/supabase-js'
import { hasCollectSecret } from '../_shared/collect-secret.ts'
import { json } from '../_shared/http.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const COLLECT_SECRET = Deno.env.get('COLLECT_SECRET') ?? ''
const RETENTION_HOURS = 48

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

Deno.serve(async (req) => {
  if (!(await hasCollectSecret(req, admin, COLLECT_SECRET))) {
    return json(401, { error: 'unauthorized' })
  }
  const cutoff = new Date(Date.now() - RETENTION_HOURS * 3_600_000).toISOString()

  const { data, error } = await admin
    .from('report_submissions')
    .select('report_id, photo_path, created_at, reports!inner(moderation)')
    .not('photo_path', 'is', null)
    .limit(500)
  if (error) return json(500, { error: error.message })

  // report_submissions -> reports est 1-1 (clé primaire = clé étrangère) : PostgREST renvoie un objet.
  const rows = (data ?? []) as unknown as Array<{
    report_id: string
    photo_path: string
    created_at: string
    reports: { moderation: string }
  }>
  const stale = rows.filter((r) => r.reports.moderation !== 'pending' || r.created_at < cutoff)
  if (stale.length === 0) return json(200, { purged: 0 })

  const { error: removeError } = await admin.storage
    .from('submissions')
    .remove(stale.map((r) => r.photo_path))
  if (removeError) return json(500, { error: removeError.message })

  await admin
    .from('report_submissions')
    .update({ photo_path: null })
    .in(
      'report_id',
      stale.map((r) => r.report_id),
    )
  // Un signalement resté sans décision 48 h est rejeté (il n'est plus d'actualité).
  await admin
    .from('reports')
    .update({ moderation: 'rejected' })
    .eq('moderation', 'pending')
    .eq('source_type', 'utilisateur')
    .lt('created_at', cutoff)

  return json(200, { purged: stale.length })
})
