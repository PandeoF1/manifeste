import { describe, expect, it } from 'vitest'
import {
  filename,
  flattenResume,
  isFormat,
  isVue,
  shapeRows,
  toCsv,
  toGeoJson,
  type Row,
} from '../api/_export'

describe('exports de données ouvertes', () => {
  const rows: Row[] = [
    { uai: '0910001A', nom: 'Lycée « Victor-Hugo »; Lille', lat: 50.63, lng: 3.06, lien: null },
    { uai: '0910002B', nom: '=SOMME(A1)', lat: null, lng: null, lien: 'https://x.example/a' },
  ]

  it('CSV : point-virgule, BOM, guillemets doublés, CRLF', () => {
    const csv = toCsv([{ a: 'dit "oui"', b: 'x;y', c: 3, d: null }])
    expect(csv.startsWith('\uFEFFa;b;c;d\r\n')).toBe(true)
    expect(csv).toContain('"dit ""oui""";"x;y";3;')
    expect(csv.endsWith('\r\n')).toBe(true)
  })

  it('CSV : une formule de tableur est neutralisée', () => {
    expect(toCsv(rows)).toContain(";'=SOMME(A1);")
  })

  it('CSV vide : seulement le BOM', () => {
    expect(toCsv([])).toBe('\uFEFF')
  })

  it('GeoJSON : [lng, lat], sans coordonnées = ignoré, licence indiquée', () => {
    const geo = JSON.parse(toGeoJson(rows)) as {
      licence: string
      features: Array<{ geometry: { coordinates: number[] }; properties: Record<string, unknown> }>
    }
    expect(geo.licence).toBe('CC BY 4.0')
    expect(geo.features).toHaveLength(1)
    expect(geo.features[0]?.geometry.coordinates).toEqual([3.06, 50.63])
    expect(geo.features[0]?.properties).not.toHaveProperty('lat')
  })

  it('le résumé est aplati en lignes clé / valeur', () => {
    const flat = flattenResume({
      etablissements: 930,
      pic: { jour: '2026-10-06', etablissements: 396 },
      origines: [{ origine: 'presse', signalements: 2426 }],
    })
    expect(flat).toContainEqual({ cle: 'etablissements', valeur: 930 })
    expect(flat).toContainEqual({ cle: 'pic.etablissements', valeur: 396 })
    expect(flat).toContainEqual({ cle: 'origines.presse.signalements', valeur: 2426 })
  })

  it('remet les colonnes dans l\u2019ordre de lecture et nomme la colonne des zones', () => {
    const [jour] = shapeRows('jours', [{ facs: 1, jour: '2026-10-06', etablissements: 396 }])
    expect(Object.keys(jour ?? {}).slice(0, 3)).toEqual(['jour', 'etablissements', 'bloques'])
    const [dep] = shapeRows('departements', [{ zone: '31', etablissements: 47, facs: 3 }])
    expect(Object.keys(dep ?? {})[0]).toBe('departement')
    expect(dep?.departement).toBe('31')
    const [acad] = shapeRows('academies', [{ zone: 'Toulouse', etablissements: 86 }])
    expect(acad?.academie).toBe('Toulouse')
  })

  it('refuse les vues et formats inconnus, nomme le fichier avec la date', () => {
    expect(isVue('jours')).toBe(true)
    expect(isVue('users')).toBe(false)
    expect(isVue(null)).toBe(false)
    expect(isFormat('geojson')).toBe(true)
    expect(isFormat('xml')).toBe(false)
    expect(filename('jours', 'csv', new Date('2026-10-07T10:00:00Z'))).toBe(
      'manifeste-jours-2026-10-07.csv',
    )
  })
})
