// Accès base (service role) et authentification communs aux Edge Functions de collecte.
import { createClient } from '@supabase/supabase-js'
import { timingSafeEqual } from './http.ts'
import { createServiceDb } from './service-db.ts'

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
export const COLLECT_SECRET = Deno.env.get('COLLECT_SECRET') ?? ''

/** Autorisé : secret partagé avec pg_cron, ou JWT d'un compte admin. */
export const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

export async function isAuthorized(req: Request): Promise<boolean> {
  if (timingSafeEqual(req.headers.get('x-collect-secret') ?? '', COLLECT_SECRET)) return true
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return false
  const { data } = await admin.auth.getUser(token)
  return data.user?.app_metadata?.role === 'admin'
}

export const db = createServiceDb(admin)
