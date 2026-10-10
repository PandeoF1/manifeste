// Statistiques anonymes du site (migrations site_analytics et track_visit_rpc) : une page vue par
// navigation, les Web Vitals et la latence de l'API à la fermeture de l'onglet, et un signal
// « onglet ouvert » toutes les 45 s tant qu'il est visible. Aucun cookie, rien d'écrit dans
// le navigateur, aucun service tiers. Désactivé avec « Do Not Track » / GPC, en admin et en dev.
import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals'
import { pageGroup, type PageGroup } from './pageGroup'
import { supabase } from './supabase'

// Fonction track_visit de la base (PostgREST) : pas d'appel de fonction Edge facturé.
const ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/track_visit`
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
/** Activé une fois la migration site_analytics et la fonction beacon en ligne. */
const ENABLED = true
const PING_MS = 45_000
const MAX_API_SAMPLES = 5

type Sample = { name: string; value: number }

function optedOut(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean }
  return (
    !ENABLED ||
    import.meta.env.DEV ||
    nav.webdriver ||
    nav.globalPrivacyControl === true ||
    nav.doNotTrack === '1'
  )
}

function send(body: { page: PageGroup; view: boolean; metrics: Sample[] }) {
  // keepalive : l'envoi survit à la fermeture de l'onglet (mesures envoyées à ce moment-là).
  void fetch(ENDPOINT, {
    method: 'POST',
    keepalive: true,
    headers: {
      apikey: ANON_KEY,
      authorization: `Bearer ${ANON_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ p_page: body.page, p_view: body.view, p_metrics: body.metrics }),
  }).catch(() => {})
}

function tabSession(): string {
  try {
    const saved = sessionStorage.getItem('tab-session')
    if (saved) return saved
    const id = crypto.randomUUID()
    sessionStorage.setItem('tab-session', id)
    return id
  } catch {
    return crypto.randomUUID()
  }
}

export function startTelemetry(router: {
  state: { location: { pathname: string } }
  subscribe: (event: 'onResolved', fn: () => void) => () => void
}) {
  if (typeof window === 'undefined' || optedOut()) return

  const firstPage = pageGroup(location.pathname)
  let current = firstPage
  let lastPath = location.pathname
  // Identifiant de l'onglet (gardé au rechargement) : rafraîchir la page ne crée pas un « visiteur en ligne » de plus.
  const session = tabSession()

  // Pages vues : la première, puis chaque changement d'adresse (hors admin).
  if (firstPage) send({ page: firstPage, view: true, metrics: [] })
  router.subscribe('onResolved', () => {
    const path = router.state.location.pathname
    if (path === lastPath) return
    lastPath = path
    current = pageGroup(path)
    if (current) {
      send({ page: current, view: true, metrics: [] })
      ping()
    }
  })

  // Mesures du chargement (rattachées à la première page), envoyées à la fermeture.
  const pending = new Map<string, number>()
  const keep = (m: Metric) => pending.set(m.name, m.value)
  onLCP(keep)
  onINP(keep)
  onCLS(keep)
  onFCP(keep)
  onTTFB(keep)

  // Latence de l'API : temps jusqu'au premier octet des premières lectures Supabase.
  const api: number[] = []
  try {
    const host = new URL(import.meta.env.VITE_SUPABASE_URL).host
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as PerformanceResourceTiming[]) {
        if (api.length >= MAX_API_SAMPLES) return
        if (!e.name.includes(host) || !e.name.includes('/rest/v1/')) continue
        const ttfb = e.responseStart > 0 ? e.responseStart - e.startTime : e.duration
        if (ttfb > 0) api.push(Math.round(ttfb))
      }
    }).observe({ type: 'resource', buffered: true })
  } catch {
    // navigateur sans PerformanceObserver
  }

  let flushed = false
  const flush = () => {
    if (flushed || !firstPage) return
    const metrics: Sample[] = [
      ...[...pending].map(([name, value]) => ({ name, value })),
      ...api.map((value) => ({ name: 'API', value })),
    ]
    if (metrics.length === 0) return
    flushed = true
    send({ page: firstPage, view: false, metrics })
  }

  // « En ligne » : un signal toutes les 45 s tant que l'onglet est visible.
  let timer: number | undefined
  function ping() {
    if (!current || document.visibilityState !== 'visible') return
    void supabase.rpc('ping_live', { p_session: session, p_page: current }).then(
      () => {},
      () => {},
    )
  }
  const schedule = () => {
    window.clearInterval(timer)
    if (document.visibilityState === 'visible') {
      ping()
      timer = window.setInterval(ping, PING_MS)
    }
  }
  schedule()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
    schedule()
  })
  window.addEventListener('pagehide', flush)
}
