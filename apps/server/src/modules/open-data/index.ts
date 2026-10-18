/**
 * Open data at /api/open-data (CC BY 4.0, open to every origin, 5-minute CDN cache):
 *   view     : summary, days, departments, academies, schools, reports,
 *              dictionary (what every column and value means; format json, csv or txt)
 *   format   : json (default), csv, geojson (schools only)
 *   download : 1 forces a file download
 * Parameters, view names, error messages and the JSON envelope are English; the columns and
 * values are the published French ones (see the dictionary).
 *
 * /api/donnees, the former French path, redirects here with its parameters translated.
 */
import { Elysia, t } from 'elysia'
import {
  ATTRIBUTION,
  DOCUMENTATION,
  filename,
  flattenSummary,
  isFormat,
  isView,
  LICENCE,
  shapeRows,
  toCsv,
  toGeoJson,
  type Row,
} from './format.ts'
import { dictionaryJson, dictionaryRows, dictionaryText } from './dictionary.ts'
import type { OpenDataService } from './service.ts'

const COMMON = {
  'access-control-allow-origin': '*',
  'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
}

const fail = (status: number, message: string) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

/** English view names, mapped to the published (French) ones. */
export const EN_VIEWS: Record<string, string> = {
  summary: 'resume',
  days: 'jours',
  departments: 'departements',
  academies: 'academies',
  schools: 'etablissements',
  reports: 'signalements',
  dictionary: 'dictionnaire',
}

const MESSAGES = {
  dictFormat: 'unknown format for the dictionary (json, csv, txt)',
  view: 'unknown view (summary, days, departments, academies, schools, reports, dictionary)',
  format: 'unknown format (json, csv, geojson)',
  geojson: 'geojson: only for the "schools" view',
  db: 'database unavailable, try again in a moment',
} as const

interface Request {
  /** The view as the caller wrote it. */
  view: string
  format: string
  download: boolean
}

async function serve(service: OpenDataService, req: Request): Promise<Response> {
  const text = MESSAGES
  const view = EN_VIEWS[req.view] ?? req.view
  const format = req.format
  // The data dictionary: no database, three formats (json, csv, txt).
  if (view === 'dictionnaire') {
    if (format === 'txt')
      return new Response(dictionaryText(), {
        headers: { ...COMMON, 'content-type': 'text/plain; charset=utf-8' },
      })
    if (format === 'csv')
      return new Response(toCsv(dictionaryRows()), {
        headers: { ...COMMON, 'content-type': 'text/csv; charset=utf-8' },
      })
    if (format === 'json')
      return new Response(JSON.stringify(dictionaryJson()), {
        headers: { ...COMMON, 'content-type': 'application/json; charset=utf-8' },
      })
    return fail(400, text.dictFormat)
  }
  if (!isView(view)) return fail(400, text.view)
  if (!isFormat(format)) return fail(400, text.format)
  if (format === 'geojson' && view !== 'etablissements') return fail(400, text.geojson)

  let data: unknown
  try {
    data = await service.get(view)
  } catch {
    return fail(502, text.db)
  }
  if (Array.isArray(data)) data = shapeRows(view, data as Row[])

  const download: Record<string, string> = req.download
    ? { 'content-disposition': `attachment; filename="${filename(view, format)}"` }
    : {}

  if (format === 'csv') {
    const rows = (
      Array.isArray(data) ? data : flattenSummary(data as Record<string, unknown>)
    ) as Row[]
    return new Response(toCsv(rows), {
      headers: { ...COMMON, ...download, 'content-type': 'text/csv; charset=utf-8' },
    })
  }
  if (format === 'geojson') {
    return new Response(toGeoJson(data as Row[]), {
      headers: { ...COMMON, ...download, 'content-type': 'application/geo+json; charset=utf-8' },
    })
  }
  const generated = new Date().toISOString()
  const envelope = {
    license: LICENCE,
    attribution: ATTRIBUTION,
    documentation: DOCUMENTATION,
    view: req.view,
    generated_at: generated,
    data,
  }
  return new Response(JSON.stringify(envelope), {
    headers: { ...COMMON, ...download, 'content-type': 'application/json; charset=utf-8' },
  })
}

/** Former French parameters and view names, translated for the redirect. */
const FR_TO_EN_VIEWS = Object.fromEntries(Object.entries(EN_VIEWS).map(([en, fr]) => [fr, en]))

export const openDataModule = (service: OpenDataService) =>
  new Elysia({ name: 'module.open-data', prefix: '/api' })
    .get(
      '/open-data',
      ({ query }) =>
        serve(service, {
          view: query.view ?? 'summary',
          format: query.format ?? 'json',
          download: query.download === '1',
        }),
      {
        query: t.Object({
          view: t.Optional(t.String()),
          format: t.Optional(t.String()),
          download: t.Optional(t.String()),
        }),
        detail: {
          tags: ['open-data'],
          summary: 'Open data (CC BY 4.0): summary, days, zones, schools, reports',
          description:
            'Views: summary, days, departments, academies, schools, reports, dictionary (the data dictionary: json, csv or txt). ' +
            'Formats: json, csv (semicolon, UTF-8 with BOM, for French Excel), geojson (schools only). ' +
            'Add download=1 to get a file. Columns and values are the published French ones (see the dictionary).',
        },
      },
    )
    .get(
      '/donnees',
      ({ query, redirect }) => {
        const params = new URLSearchParams()
        if (query.vue) params.set('view', FR_TO_EN_VIEWS[query.vue] ?? query.vue)
        if (query.format) params.set('format', query.format)
        if (query.telecharger) params.set('download', query.telecharger)
        const qs = params.toString()
        return redirect(`/api/open-data${qs ? `?${qs}` : ''}`, 301)
      },
      {
        query: t.Object({
          vue: t.Optional(t.String()),
          format: t.Optional(t.String()),
          telecharger: t.Optional(t.String()),
        }),
        detail: {
          tags: ['open-data'],
          summary: 'Former French path of /api/open-data (redirects, parameters translated)',
          deprecated: true,
        },
      },
    )
