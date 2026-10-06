// Validation des envois du navigateur pour les statistiques anonymes du site.

export const PAGES = ['carte', 'liste', 'lycee', 'signaler', 'a-propos', 'autre'] as const
export type PageGroup = (typeof PAGES)[number]
export const METRICS = ['LCP', 'INP', 'CLS', 'FCP', 'TTFB', 'API'] as const

export interface Beacon {
  page: PageGroup
  view: boolean
  metrics: Array<{ name: (typeof METRICS)[number]; value: number }>
}

/** Robots et navigateurs automatisés : ni visite ni mesure. */
export const BOT_UA = /bot|crawl|spider|slurp|preview|headless|lighthouse|pagespeed|curl|wget/i

/** Lit un envoi (texte JSON, au plus 2 Ko) ; null s'il est invalide. */
export function parseBeacon(raw: string): Beacon | null {
  if (raw.length > 2048) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object') return null
  const d = data as { page?: unknown; view?: unknown; metrics?: unknown }
  const page = (PAGES as readonly unknown[]).includes(d.page) ? (d.page as PageGroup) : 'autre'
  const metrics = (Array.isArray(d.metrics) ? d.metrics : []).slice(0, 12).flatMap((m: unknown) => {
    const { name, value } = (m ?? {}) as { name?: unknown; value?: unknown }
    return (METRICS as readonly unknown[]).includes(name) &&
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= 0
      ? [{ name: name as Beacon['metrics'][number]['name'], value }]
      : []
  })
  const view = d.view === true
  if (!view && metrics.length === 0) return null
  return { page, view, metrics }
}
