import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    'VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY doivent être définies (voir .env.example).',
  )
}

export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    // La session n'existe que pour l'admin ; le public n'a jamais de session.
    persistSession: true,
    autoRefreshToken: true,
  },
})
