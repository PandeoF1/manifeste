// Anonymous site statistics (site_analytics and track_visit_rpc migrations): one page view per
// navigation, the Web Vitals and API latency when the tab closes, and an
// "tab open" signal every 45 s while it is visible. No cookie, nothing written in
// the browser, no third-party service. Disabled with "Do Not Track" / GPC, in admin and in dev.
import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals'
import { pageGroup, type PageGroup } from './pageGroup'

const BEACON = '/api/analytics/beacon'
const PING = '/api/analytics/ping'
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
  // keepalive: the request survives the tab closing (measurements are sent then).
  void fetch(BEACON, {
    method: 'POST',
    keepalive: true,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
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
  // Tab identifier (kept across reloads): refreshing the page does not create one more "visitor online".
  const session = tabSession()

  // Page views: the first, then every address change (outside admin).
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

  // Load measurements (attached to the first page), sent on close.
  const pending = new Map<string, number>()
  const keep = (m: Metric) => pending.set(m.name, m.value)
  onLCP(keep)
  onINP(keep)
  onCLS(keep)
  onFCP(keep)
  onTTFB(keep)

  // API latency: time to first byte of the first reads of the API.
  const api: number[] = []
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as PerformanceResourceTiming[]) {
        if (api.length >= MAX_API_SAMPLES) return
        if (!new URL(e.name).pathname.startsWith('/api/') || !e.name.includes('/api/statuses'))
          continue
        const ttfb = e.responseStart > 0 ? e.responseStart - e.startTime : e.duration
        if (ttfb > 0) api.push(Math.round(ttfb))
      }
    }).observe({ type: 'resource', buffered: true })
  } catch {
    // browser without PerformanceObserver
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

  // "Online": a signal every 45 s while the tab is visible.
  let timer: number | undefined
  function ping() {
    if (!current || document.visibilityState !== 'visible') return
    void fetch(PING, {
      method: 'POST',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session, page: current }),
    }).catch(() => {})
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
