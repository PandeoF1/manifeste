import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { addReport, addSchool } from './seed.ts'
import { startTestServer, type TestServer } from './helpers.ts'

let s: TestServer
const uai = {} as { lille: string; marseille: string; nanterre: string }

beforeAll(async () => {
  s = await startTestServer()
  const db = s.ctx.db
  uai.lille = await addSchool(db, {
    name: 'Lycée Pasteur',
    city: 'Lille',
    department: '59',
    academy: 'Lille',
    lat: 50.63,
    lng: 3.06,
  })
  uai.marseille = await addSchool(db, {
    name: 'Lycée Curie',
    city: 'Marseille',
    department: '13',
    academy: 'Aix-Marseille',
    lat: 43.29,
    lng: 5.37,
  })
  uai.nanterre = await addSchool(db, {
    name: 'Université de Nanterre',
    city: 'Nanterre',
    department: '92',
    academy: 'Versailles',
    level: 'higher',
    lat: 48.9,
    lng: 2.21,
  })
  await addReport(db, { schoolUai: uai.lille, status: 'blocked', hoursAgo: 1, origin: 'press' })
  await addReport(db, {
    schoolUai: uai.lille,
    status: 'filtering',
    hoursAgo: 30,
    origin: 'union',
    sourceDomain: 'syndicat.org',
  })
  await addReport(db, {
    schoolUai: uai.marseille,
    status: 'blocked',
    hoursAgo: 2,
    origin: 'on_site',
  })
  await addReport(db, {
    schoolUai: uai.nanterre,
    status: 'lifted',
    hoursAgo: 3,
    origin: 'aggregator',
  })
  await addReport(db, {
    schoolUai: uai.nanterre,
    status: 'blocked',
    hoursAgo: 4,
    moderation: 'pending',
  })
})
afterAll(() => s.close())

// The published JSON is French and loosely shaped; the tests assert on the pieces they care about.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any

const donnees = async (query: string): Promise<{ res: Response; body: Loose }> => {
  const res = await s.request(`/api/donnees${query}`)
  return { res, body: await res.json() }
}

describe('/api/donnees', () => {
  test('summary: counts, peak, current status and origins, in the published French shape', async () => {
    const { res, body } = await donnees('?vue=resume')
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('cache-control')).toContain('s-maxage=300')
    expect(body).toMatchObject({ licence: 'CC BY 4.0', vue: 'resume' })
    const d = body.donnees
    expect(d).toMatchObject({
      signalements: 4,
      etablissements: 2,
      departements: 2,
      facs: 0,
      mobilises: 0,
    })
    expect(d.en_ce_moment).toEqual({ bloques: 2, filtrants: 0 })
    expect(d.origines.map((o: { origine: string }) => o.origine).sort()).toEqual([
      'collecteur',
      'presse',
      'syndicat',
      'utilisateur',
    ])
    expect(d.pic.etablissements).toBeGreaterThanOrEqual(1)
  })

  test('days: one row per calendar day, French column names and values', async () => {
    const { body } = await donnees('?vue=jours')
    const rows = body.donnees as Array<Record<string, number | string>>
    expect(rows.length).toBeGreaterThanOrEqual(1)
    expect(Object.keys(rows[0] ?? {}).slice(0, 4)).toEqual([
      'jour',
      'etablissements',
      'bloques',
      'filtrants',
    ])
    const total = rows.reduce((n, r) => n + Number(r.signalements), 0)
    expect(total).toBe(4)
    expect(rows.reduce((n, r) => n + Number(r.via_signalements_sur_place), 0)).toBe(1)
  })

  test('zones: departments and academies, first column named after the zone', async () => {
    const dep = (await donnees('?vue=departements')).body.donnees as Array<Record<string, unknown>>
    expect(Object.keys(dep[0] ?? {})[0]).toBe('departement')
    expect(dep.map((r) => r.departement).sort()).toEqual(['13', '59'])
    const lille = dep.find((r) => r.departement === '59')
    expect(lille).toMatchObject({ etablissements: 1, lycees: 1, facs: 0, bloques_maintenant: 1 })
    const acad = (await donnees('?vue=academies')).body.donnees as Array<Record<string, unknown>>
    expect(Object.keys(acad[0] ?? {})[0]).toBe('academie')
  })

  test('schools: only the ones that were blocked or filtering, with live status', async () => {
    const { body } = await donnees('?vue=etablissements')
    const rows = body.donnees as Array<Record<string, unknown>>
    expect(rows.map((r) => r.uai).sort()).toEqual([uai.lille, uai.marseille].sort())
    const lille = rows.find((r) => r.uai === uai.lille)
    expect(lille).toMatchObject({
      nom: 'Lycée Pasteur',
      niveau: 'lycee',
      dernier_statut: 'bloque',
      statut_direct: 'bloque',
      signalements: 2,
    })
    expect(String(lille?.origines)).toBe('presse syndicat')
    expect(rows.find((r) => r.uai === uai.marseille)).toMatchObject({
      origines: 'utilisateur',
      sites_sources: 0,
    })
  })

  test('reports: validated ones only, on-site reports carry no source', async () => {
    const { body } = await donnees('?vue=signalements')
    const rows = body.donnees as Array<Record<string, unknown>>
    expect(rows).toHaveLength(4)
    const onSite = rows.find((r) => r.origine === 'utilisateur')
    expect(onSite).toMatchObject({ site_source: null, lien_source: null, statut: 'bloque' })
    expect(rows.some((r) => r.niveau === 'superieur' && r.statut === 'bloque')).toBe(false)
  })

  test('CSV and GeoJSON exports', async () => {
    const csv = await s.request('/api/donnees?vue=jours&format=csv&telecharger=1')
    expect(csv.headers.get('content-type')).toContain('text/csv')
    expect(csv.headers.get('content-disposition')).toMatch(
      /^attachment; filename="manifeste-jours-\d{4}-\d{2}-\d{2}\.csv"$/,
    )
    // The bytes, not `text()`: a text decoder drops a leading byte order mark, which Excel needs.
    const bytes = new Uint8Array(await csv.arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(
      new TextDecoder('utf-8', { ignoreBOM: true })
        .decode(bytes)
        .startsWith('\ufeffjour;etablissements;'),
    ).toBe(true)

    const geo = await s.request('/api/donnees?vue=etablissements&format=geojson')
    expect(geo.headers.get('content-type')).toContain('application/geo+json')
    const json = (await geo.json()) as { features: Array<{ geometry: { coordinates: number[] } }> }
    expect(json.features).toHaveLength(2)
  })

  test('errors keep the published { erreur } shape', async () => {
    for (const query of ['?vue=users', '?format=xml', '?vue=jours&format=geojson']) {
      const res = await s.request(`/api/donnees${query}`)
      expect(res.status).toBe(400)
      expect(Object.keys((await res.json()) as object)).toEqual(['erreur'])
    }
  })
})
