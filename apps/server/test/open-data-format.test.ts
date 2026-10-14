import { describe, expect, test } from 'bun:test'
import {
  filename,
  flattenSummary,
  isFormat,
  isView,
  shapeRows,
  toCsv,
  toGeoJson,
  type Row,
} from '../src/modules/open-data/format.ts'

describe('open data exports', () => {
  const rows: Row[] = [
    { uai: '0910001A', nom: 'Lycée « Victor-Hugo »; Lille', lat: 50.63, lng: 3.06, lien: null },
    { uai: '0910002B', nom: '=SOMME(A1)', lat: null, lng: null, lien: 'https://x.example/a' },
  ]

  test('CSV: semicolon, BOM, doubled quotes, CRLF', () => {
    const csv = toCsv([{ a: 'dit "oui"', b: 'x;y', c: 3, d: null }])
    expect(csv.startsWith('﻿a;b;c;d\r\n')).toBe(true)
    expect(csv).toContain('"dit ""oui""";"x;y";3;')
    expect(csv.endsWith('\r\n')).toBe(true)
  })

  test('CSV: a spreadsheet formula is neutralised', () => {
    expect(toCsv(rows)).toContain(";'=SOMME(A1);")
  })

  test('empty CSV: only the BOM', () => {
    expect(toCsv([])).toBe('﻿')
  })

  test('GeoJSON: [lng, lat], rows without coordinates are skipped, licence stated', () => {
    const geo = JSON.parse(toGeoJson(rows)) as {
      licence: string
      features: Array<{ geometry: { coordinates: number[] }; properties: Record<string, unknown> }>
    }
    expect(geo.licence).toBe('CC BY 4.0')
    expect(geo.features).toHaveLength(1)
    expect(geo.features[0]?.geometry.coordinates).toEqual([3.06, 50.63])
    expect(geo.features[0]?.properties).not.toHaveProperty('lat')
  })

  test('the summary is flattened into key / value rows', () => {
    const flat = flattenSummary({
      etablissements: 930,
      pic: { jour: '2026-10-06', etablissements: 396 },
      origines: [{ origine: 'presse', signalements: 2426 }],
    })
    expect(flat).toContainEqual({ cle: 'etablissements', valeur: 930 })
    expect(flat).toContainEqual({ cle: 'pic.etablissements', valeur: 396 })
    expect(flat).toContainEqual({ cle: 'origines.presse.signalements', valeur: 2426 })
  })

  test('columns come in reading order and zone views name their first column', () => {
    const [day] = shapeRows('jours', [{ facs: 1, jour: '2026-10-06', etablissements: 396 }])
    expect(Object.keys(day ?? {}).slice(0, 3)).toEqual(['jour', 'etablissements', 'bloques'])
    const [dep] = shapeRows('departements', [{ zone: '31', etablissements: 47, facs: 3 }])
    expect(Object.keys(dep ?? {})[0]).toBe('departement')
    expect(dep?.departement).toBe('31')
    const [acad] = shapeRows('academies', [{ zone: 'Toulouse', etablissements: 86 }])
    expect(acad?.academie).toBe('Toulouse')
  })

  test('unknown views and formats are refused; the file name carries the date', () => {
    expect(isView('jours')).toBe(true)
    expect(isView('users')).toBe(false)
    expect(isView(null)).toBe(false)
    expect(isFormat('geojson')).toBe(true)
    expect(isFormat('xml')).toBe(false)
    expect(filename('jours', 'csv', new Date('2026-10-07T10:00:00Z'))).toBe(
      'manifeste-jours-2026-10-07.csv',
    )
  })
})
