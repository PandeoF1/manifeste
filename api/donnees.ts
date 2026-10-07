// Données ouvertes : /api/donnees?vue=jours&format=csv
//   vue    : resume, jours, departements, academies, etablissements, signalements
//   format : json (défaut), csv, geojson (établissements seulement)
//   telecharger=1 : force le téléchargement du fichier
// Ouvert à tous (CORS *), cache de 5 minutes au CDN. Licence CC BY 4.0.
import { openData } from './_data'
import {
  ATTRIBUTION,
  LICENCE,
  filename,
  flattenResume,
  isFormat,
  isVue,
  shapeRows,
  toCsv,
  toGeoJson,
  type Row,
} from './_export'

export const config = { runtime: 'edge' }

const COMMON = {
  'access-control-allow-origin': '*',
  'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
}

function fail(status: number, message: string): Response {
  return new Response(JSON.stringify({ erreur: message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const vue = url.searchParams.get('vue') ?? 'resume'
  const format = url.searchParams.get('format') ?? 'json'
  if (!isVue(vue))
    return fail(
      400,
      'vue inconnue (resume, jours, departements, academies, etablissements, signalements)',
    )
  if (!isFormat(format)) return fail(400, 'format inconnu (json, csv, geojson)')
  if (format === 'geojson' && vue !== 'etablissements')
    return fail(400, 'geojson : seulement pour la vue « etablissements »')

  let data: unknown
  try {
    data = await openData(vue)
  } catch {
    return fail(502, 'base indisponible, réessaie dans un instant')
  }

  // Vues en lignes : colonnes dans l'ordre de lecture (le résumé reste un objet).
  if (Array.isArray(data)) data = shapeRows(vue, data as Row[])

  const download: Record<string, string> =
    url.searchParams.get('telecharger') === '1'
      ? { 'content-disposition': `attachment; filename="${filename(vue, format)}"` }
      : {}

  if (format === 'csv') {
    const rows = (
      Array.isArray(data) ? data : flattenResume(data as Record<string, unknown>)
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
  return new Response(
    JSON.stringify({
      licence: LICENCE,
      attribution: ATTRIBUTION,
      vue,
      genere_le: new Date().toISOString(),
      donnees: data,
    }),
    { headers: { ...COMMON, ...download, 'content-type': 'application/json; charset=utf-8' } },
  )
}
