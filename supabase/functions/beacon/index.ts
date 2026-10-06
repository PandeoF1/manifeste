// Edge Function : statistiques anonymes du site (page vue + mesures de performance).
// L'IP ne sert qu'à l'empreinte du jour, calculée en base avec le sel quotidien ; elle n'est
// jamais stockée ni journalisée. Navigateur, OS et référent ne sont pas lus.
import { createClient } from '@supabase/supabase-js'
import { BOT_UA, parseBeacon } from '../_shared/beacon.ts'
import { corsHeaders } from '../_shared/http.ts'

const admin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false, autoRefreshToken: false } },
)

function clientIp(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    ''
  )
}

const done = () => new Response(null, { status: 204, headers: corsHeaders })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: corsHeaders })
  if (BOT_UA.test(req.headers.get('user-agent') ?? '')) return done()
  const beacon = parseBeacon(await req.text().catch(() => ''))
  if (!beacon) return done()
  const { error } = await admin.rpc('record_beacon', {
    p_ip: clientIp(req),
    p_page: beacon.page,
    p_view: beacon.view,
    p_metrics: beacon.metrics,
  })
  if (error) console.error('record_beacon', error.message)
  return done()
})
