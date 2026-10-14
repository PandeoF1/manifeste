/**
 * Open data at /api/donnees (CC BY 4.0, open to every origin, 5-minute CDN cache):
 *   vue    : resume, jours, departements, academies, etablissements, signalements
 *   format : json (default), csv, geojson (etablissements only)
 *   telecharger=1 : force a file download
 * Parameter names, view names and the `erreur` key are the published contract, kept in French.
 */
import { Elysia, t } from 'elysia'
import {
  ATTRIBUTION,
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
import type { OpenDataService } from './service.ts'

const COMMON = {
  'access-control-allow-origin': '*',
  'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
}

const fail = (status: number, message: string) =>
  new Response(JSON.stringify({ erreur: message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

export const openDataModule = (service: OpenDataService) =>
  new Elysia({ name: 'module.open-data', prefix: '/api' }).get(
    '/donnees',
    async ({ query }) => {
      const view = query.vue ?? 'resume'
      const format = query.format ?? 'json'
      if (!isView(view))
        return fail(
          400,
          'vue inconnue (resume, jours, departements, academies, etablissements, signalements)',
        )
      if (!isFormat(format)) return fail(400, 'format inconnu (json, csv, geojson)')
      if (format === 'geojson' && view !== 'etablissements')
        return fail(400, 'geojson : seulement pour la vue « etablissements »')

      let data: unknown
      try {
        data = await service.get(view)
      } catch {
        return fail(502, 'base indisponible, réessaie dans un instant')
      }
      if (Array.isArray(data)) data = shapeRows(view, data as Row[])

      const download: Record<string, string> =
        query.telecharger === '1'
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
          headers: {
            ...COMMON,
            ...download,
            'content-type': 'application/geo+json; charset=utf-8',
          },
        })
      }
      return new Response(
        JSON.stringify({
          licence: LICENCE,
          attribution: ATTRIBUTION,
          vue: view,
          genere_le: new Date().toISOString(),
          donnees: data,
        }),
        { headers: { ...COMMON, ...download, 'content-type': 'application/json; charset=utf-8' } },
      )
    },
    {
      // Validated by hand above so that errors keep the published `{ erreur }` shape.
      query: t.Object({
        vue: t.Optional(t.String()),
        format: t.Optional(t.String()),
        telecharger: t.Optional(t.String()),
      }),
      detail: {
        tags: ['open-data'],
        summary: 'Open data (CC BY 4.0): summary, days, zones, schools, reports',
        description:
          'Views: resume, jours, departements, academies, etablissements, signalements. ' +
          'Formats: json, csv (semicolon, UTF-8 with BOM, for French Excel), geojson (etablissements only).',
      },
    },
  )
