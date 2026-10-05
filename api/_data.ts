// Lecture des données publiques (clé anon, RLS appliquée) pour les aperçus de partage.

export type Status = 'bloque' | 'filtrant' | 'leve'

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? ''

async function rest<T>(path: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: ANON_KEY, authorization: `Bearer ${ANON_KEY}` },
    signal: AbortSignal.timeout(4000),
  })
  if (!res.ok) throw new Error(`Supabase HTTP ${res.status}`)
  return (await res.json()) as T
}

export interface NationalSummary {
  bloque: number
  filtrant: number
  departments: number
}

export async function nationalSummary(): Promise<NationalSummary> {
  const rows = await rest<Array<{ status: Status; department: string | null }>>(
    'school_current_status?select=status,department',
  )
  const departments = new Set<string>()
  let bloque = 0
  let filtrant = 0
  for (const r of rows) {
    if (r.status === 'bloque') bloque++
    if (r.status === 'filtrant') filtrant++
    if (r.status !== 'leve' && r.department) departments.add(r.department)
  }
  return { bloque, filtrant, departments: departments.size }
}

export interface SchoolSummary {
  uai: string
  name: string
  city: string
  department: string | null
  status: Status | null
  last_signal_at: string | null
}

export async function schoolSummary(uai: string): Promise<SchoolSummary | null> {
  if (!/^[0-9]{7}[A-Z]$/.test(uai)) return null
  const active = await rest<SchoolSummary[]>(
    `school_current_status?uai=eq.${uai}&select=uai,name,city,department,status,last_signal_at`,
  )
  if (active[0]) return active[0]
  const school = await rest<
    Array<{ uai: string; name: string; city: string; department: string | null }>
  >(`schools?uai=eq.${uai}&select=uai,name,city,department`)
  return school[0] ? { ...school[0], status: null, last_signal_at: null } : null
}

export const STATUS_LABEL: Record<Status, string> = {
  bloque: 'Bloqué',
  filtrant: 'Barrage filtrant',
  leve: 'Blocus levé',
}

export const STATUS_COLOR: Record<Status, string> = {
  bloque: '#ff453a',
  filtrant: '#ff9f0a',
  leve: '#98a2b3',
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n > 1 ? many : one}`
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

const timeFmt = new Intl.DateTimeFormat('fr-FR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Paris',
})
export function parisTime(iso: string): string {
  return timeFmt.format(new Date(iso)).replace(':', 'h')
}
