/**
 * Open data at /api/donnees (CC BY 4.0, open to every origin, 5-minute CDN cache):
 *   vue    : resume, jours, departements, academies, etablissements, signalements,
 *            dictionnaire (what every column and value means; format json, csv or txt)
 *   format : json (default), csv, geojson (etablissements only)
 *   telecharger=1 : force a file download
 * Parameter names, view names and the `erreur` key are the published contract, kept in French.
 *
 * English alias, same data: /api/open-data?view=&format=&download=1, with the views summary,
 * days, departments, academies, schools, reports, dictionary. Parameters, view names, error
 * messages and the JSON envelope are English; the columns and values stay the published French
 * ones (a second contract to keep in sync would help nobody).
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

type Lang = 'fr' | 'en'

const failIn = (lang: Lang) => (status: number, message: string) =>
  new Response(JSON.stringify({ [lang === 'fr' ? 'erreur' : 'error']: message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

/** English view names of the alias, mapped to the published ones. */
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
  fr: {
    dictFormat: 'format inconnu pour le dictionnaire (json, csv, txt)',
    view: 'vue inconnue (resume, jours, departements, academies, etablissements, signalements, dictionnaire)',
    format: 'format inconnu (json, csv, geojson)',
    geojson: 'geojson : seulement pour la vue « etablissements »',
    db: 'base indisponible, réessaie dans un instant',
  },
  en: {
    dictFormat: 'unknown format for the dictionary (json, csv, txt)',
    view: 'unknown view (summary, days, departments, academies, schools, reports, dictionary)',
    format: 'unknown format (json, csv, geojson)',
    geojson: 'geojson: only for the "schools" view',
    db: 'database unavailable, try again in a moment',
  },
} as const

interface Request {
  /** The view as the caller wrote it (in the caller's language). */
  view: string
  format: string
  download: boolean
}

async function serve(service: OpenDataService, req: Request, lang: Lang): Promise<Response> {
  const fail = failIn(lang)
  const text = MESSAGES[lang]
  const view = lang === 'en' ? (EN_VIEWS[req.view] ?? req.view) : req.view
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
  const envelope =
    lang === 'fr'
      ? {
          licence: LICENCE,
          attribution: ATTRIBUTION,
          documentation: DOCUMENTATION,
          vue: view,
          genere_le: generated,
          donnees: data,
        }
      : {
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

export const openDataModule = (service: OpenDataService) =>
  new Elysia({ name: 'module.open-data', prefix: '/api' })
    .get(
      '/donnees',
      ({ query }) =>
        serve(
          service,
          {
            view: query.vue ?? 'resume',
            format: query.format ?? 'json',
            download: query.telecharger === '1',
          },
          'fr',
        ),
      {
        // Validated by hand so that errors keep the published `{ erreur }` shape.
        query: t.Object({
          vue: t.Optional(t.String()),
          format: t.Optional(t.String()),
          telecharger: t.Optional(t.String()),
        }),
        detail: {
          tags: ['open-data'],
          summary: 'Open data (CC BY 4.0): summary, days, zones, schools, reports',
          description:
            'Views: resume, jours, departements, academies, etablissements, signalements, dictionnaire (the data dictionary: json, csv or txt). ' +
            'Formats: json, csv (semicolon, UTF-8 with BOM, for French Excel), geojson (etablissements only).',
        },
      },
    )
    .get(
      '/open-data',
      ({ query }) =>
        serve(
          service,
          {
            view: query.view ?? 'summary',
            format: query.format ?? 'json',
            download: query.download === '1',
          },
          'en',
        ),
      {
        query: t.Object({
          view: t.Optional(t.String()),
          format: t.Optional(t.String()),
          download: t.Optional(t.String()),
        }),
        detail: {
          tags: ['open-data'],
          summary: 'Open data, English alias of /api/donnees',
          description:
            'The same data as /api/donnees with English parameters and view names. ' +
            'Views: summary, days, departments, academies, schools, reports, dictionary. ' +
            'Formats: json, csv, geojson (schools only); dictionary: json, csv, txt. ' +
            'Add download=1 to get a file. Columns and values are the published French ones (see the dictionary).',
        },
      },
    )
