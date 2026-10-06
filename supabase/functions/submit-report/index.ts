// Edge Function : signalement public géolocalisé, photo facultative.
// Anonymat : pas de compte, pas de nom, IP jamais stockée (empreinte salée du jour, en base),
// photo sans métadonnées, position arrondie à ~100 m et réservée au staff.
// Rien n'est publié sans validation du staff.
import { createClient } from '@supabase/supabase-js'
import { extractDomain } from '../_shared/domain.ts'
import { corsHeaders, json } from '../_shared/http.ts'
import { detectImageKind, hasMetadata } from '../_shared/image.ts'
import {
  DAILY_LIMIT,
  MAX_DISTANCE_M,
  MAX_PHOTO_BYTES,
  SUBMIT_ERRORS,
  roundCoord,
  submissionFieldsSchema,
  type SubmitErrorCode,
} from '../_shared/submission.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
// Si absent (développement local), la vérification Turnstile est désactivée.
const TURNSTILE_SECRET = Deno.env.get('TURNSTILE_SECRET_KEY') ?? ''

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function fail(status: number, error: SubmitErrorCode) {
  return json(status, { ok: false, error, message: SUBMIT_ERRORS[error] })
}

async function verifyTurnstile(token: string | undefined): Promise<boolean> {
  // Sans clé secrète, le captcha n'est sauté qu'en local (supabase functions serve) :
  // en production, un oubli de configuration doit bloquer, pas ouvrir le formulaire aux robots.
  if (!TURNSTILE_SECRET)
    return Deno.env.get('SB_REGION') == null && !Deno.env.get('DENO_DEPLOYMENT_ID')
  if (!token) return false
  // L'IP du visiteur n'est volontairement pas transmise à Cloudflare.
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({ secret: TURNSTILE_SECRET, response: token }),
    signal: AbortSignal.timeout(10_000),
  })
  const body = (await res.json().catch(() => ({}))) as { success?: boolean }
  return body.success === true
}

function clientIp(req: Request): string {
  // Utilisée uniquement pour calculer l'empreinte anti-abus, jamais stockée ni journalisée.
  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    ''
  )
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return fail(405, 'invalid_input')

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return fail(400, 'invalid_input')
  }

  const text = (key: string) => {
    const v = form.get(key)
    return typeof v === 'string' ? v : undefined
  }
  const parsed = submissionFieldsSchema.safeParse({
    school_uai: text('school_uai'),
    status: text('status'),
    lat: text('lat'),
    lng: text('lng'),
    source_url: text('source_url'),
    turnstile_token: text('turnstile_token'),
  })
  if (!parsed.success) return fail(400, 'invalid_input')
  const input = parsed.data

  try {
    if (!(await verifyTurnstile(input.turnstile_token))) return fail(403, 'captcha_failed')

    // Photo : contrôlée avant de consommer le quota.
    let photo: Uint8Array | null = null
    let photoKind: 'jpeg' | 'webp' | null = null
    const file = form.get('photo')
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_PHOTO_BYTES) return fail(413, 'photo_invalid')
      photo = new Uint8Array(await file.arrayBuffer())
      photoKind = detectImageKind(photo)
      if (!photoKind) return fail(415, 'photo_invalid')
      if (hasMetadata(photo)) return fail(422, 'photo_metadata')
    }

    const { data: distance, error: distanceError } = await admin.rpc('school_distance_m', {
      p_uai: input.school_uai,
      p_lat: input.lat,
      p_lng: input.lng,
    })
    if (distanceError) throw distanceError
    if (distance === null) return fail(404, 'unknown_school')
    if (distance > MAX_DISTANCE_M) return fail(422, 'too_far')

    const { data: allowed, error: rateError } = await admin.rpc('consume_rate_limit', {
      p_ip: clientIp(req),
      p_limit: DAILY_LIMIT,
    })
    if (rateError) throw rateError
    if (!allowed) return fail(429, 'rate_limited')

    const reportId = crypto.randomUUID()
    let photoPath: string | null = null
    if (photo && photoKind) {
      // Nom aléatoire, sans lien avec l'envoi.
      photoPath = `${crypto.randomUUID()}.${photoKind === 'jpeg' ? 'jpg' : 'webp'}`
      const { error } = await admin.storage
        .from('submissions')
        .upload(photoPath, photo, { contentType: `image/${photoKind}`, upsert: false })
      if (error) throw error
    }

    const { error: insertError } = await admin.from('reports').insert({
      id: reportId,
      school_uai: input.school_uai,
      status: input.status,
      source_type: 'utilisateur',
      source_url: input.source_url ?? null,
      source_domain: input.source_url ? extractDomain(input.source_url) : null,
      moderation: 'pending',
      observed_at: new Date().toISOString(),
    })
    if (insertError) {
      if (photoPath) await admin.storage.from('submissions').remove([photoPath])
      throw insertError
    }

    const { error: privateError } = await admin.from('report_submissions').insert({
      report_id: reportId,
      photo_path: photoPath,
      lat: roundCoord(input.lat),
      lng: roundCoord(input.lng),
      distance_m: distance,
    })
    if (privateError) throw privateError

    return json(201, { ok: true })
  } catch (e) {
    // Message technique seulement : aucune donnée de la requête n'est journalisée.
    console.error('submit-report:', e instanceof Error ? e.message : 'erreur inconnue')
    return fail(500, 'server_error')
  }
})
