import { describe, expect, it } from 'vitest'
import {
  buildSites,
  departmentCode,
  shortLabel,
  splitCommune,
  titleCase,
  type Implantation,
  type Principal,
} from '../scripts/higher-ed'

const impl = (over: Partial<Implantation>): Implantation => ({
  uai: '0000001A',
  etablissement_uai: '0000000Z',
  siege_lib: 'Université de Exemple',
  implantation_lib: 'UNIVERSITE DE EXEMPLE',
  bcnag_n_nature_uai_libelle_editi: 'Université',
  coordonnees: { lat: 48.85, lon: 2.35 },
  com_nom: 'Exemple',
  code_postal_uai: '75005',
  dep_id: 'D075',
  aca_nom: 'Paris',
  ...over,
})

describe('établissements du supérieur', () => {
  it('outils de nommage', () => {
    expect(splitCommune('Paris  13e')).toEqual({ city: 'Paris', district: 'Paris 13e' })
    expect(splitCommune('Nanterre')).toEqual({ city: 'Nanterre', district: 'Nanterre' })
    expect(departmentCode('D059')).toBe('59')
    expect(departmentCode('D02A')).toBe('2A')
    expect(departmentCode('D971')).toBe('971')
    expect(titleCase("ECOLE NATIONALE D'INGENIEURS DE TARBES")).toBe(
      "Ecole Nationale d'Ingenieurs de Tarbes",
    )
    expect(shortLabel('UNITE DE FORMATION ET DE RECHERCHE DE DROIT ET SCIENCE POLITIQUE')).toMatch(
      /^UFR de Droit/,
    )
    expect(shortLabel("INSTITUT D'ETUDES TRES LONGUES DE QUELQUE CHOSE D'AUTRE")).not.toMatch(
      /\b(d'|de|du)$/i,
    )
  })

  it('regroupe les UFR d’un même lieu et sépare les sites éloignés', () => {
    const sites = buildSites([
      impl({ uai: '0000001A' }),
      impl({
        uai: '0000002B',
        implantation_lib: 'UFR DROIT',
        bcnag_n_nature_uai_libelle_editi: 'Unité de formation et de recherche (hors santé)',
        coordonnees: { lat: 48.851, lon: 2.351 },
      }),
      impl({
        uai: '0000003C',
        implantation_lib: 'UFR LETTRES',
        bcnag_n_nature_uai_libelle_editi: 'Unité de formation et de recherche (hors santé)',
        com_nom: 'Autreville',
        coordonnees: { lat: 49.2, lon: 2.9 },
        code_postal_uai: '60000',
        dep_id: 'D060',
      }),
    ])
    expect(sites.map((s) => s.name)).toEqual([
      'Université de Exemple – Autreville',
      'Université de Exemple – Exemple',
    ])
    const main = sites.find((s) => s.city === 'Exemple')
    expect(main?.uai).toBe('0000001A') // le plus représentatif du lieu
    expect(main?.department).toBe('75')
  })

  it('ignore les services communs, l’étranger, les UAI invalides ; un seul site = nom de l’établissement', () => {
    const sites = buildSites([
      impl({}),
      impl({
        uai: '0000009Z',
        bcnag_n_nature_uai_libelle_editi: 'Service commun de documentation',
      }),
      impl({
        uai: '0000008Y',
        dep_id: 'D999',
        com_nom: 'Madrid',
        coordonnees: { lat: 40.4, lon: -3.7 },
      }),
      impl({ uai: 'invalide' }),
      impl({ uai: '0000007X', coordonnees: null }),
    ])
    expect(sites).toHaveLength(1)
    expect(sites[0]?.name).toBe('Université de Exemple')
  })

  it('ajoute les établissements principaux sans implantation (privés compris), sans doublon', () => {
    const principals: Principal[] = [
      {
        uai: '0000000Z', // déjà couvert par les implantations
        uo_lib: 'Université de Exemple',
        coordonnees: { lat: 1, lon: 1 },
        com_nom: 'Exemple',
        code_postal_uai: null,
        dep_id: 'D075',
        aca_nom: null,
      },
      {
        uai: '0690001A',
        uo_lib: 'Skema  Business School',
        coordonnees: { lat: 45.76, lon: 4.83 },
        com_nom: 'Lyon  2e',
        code_postal_uai: '69002',
        dep_id: 'D069',
        aca_nom: 'Lyon',
      },
      {
        uai: null,
        uo_lib: 'Sans UAI',
        coordonnees: null,
        com_nom: null,
        code_postal_uai: null,
        dep_id: null,
        aca_nom: null,
      },
    ]
    const sites = buildSites([impl({})], principals)
    expect(sites.map((s) => s.name)).toEqual(['Skema Business School', 'Université de Exemple'])
    expect(sites[0]?.city).toBe('Lyon')
  })

  it('nom d’usage sur le plus gros site (Rennes 2 -> Villejean), jamais deux noms identiques', () => {
    const sites = buildSites([
      impl({
        etablissement_uai: '0350001A',
        siege_lib: 'Université Rennes 2',
        uai: '0350002B',
        com_nom: 'Rennes',
        dep_id: 'D035',
      }),
      impl({
        etablissement_uai: '0350001A',
        siege_lib: 'Université Rennes 2',
        uai: '0350003C',
        bcnag_n_nature_uai_libelle_editi: 'Institut universitaire de technologie',
        implantation_lib: 'IUT',
        com_nom: 'Rennes',
        dep_id: 'D035',
        coordonnees: { lat: 48.1, lon: -1.7 },
      }),
      impl({
        etablissement_uai: '0350001A',
        siege_lib: 'Université Rennes 2',
        uai: '0350004D',
        bcnag_n_nature_uai_libelle_editi: 'Institut universitaire de technologie',
        implantation_lib: 'IUT',
        com_nom: 'Rennes',
        dep_id: 'D035',
        coordonnees: { lat: 48.2, lon: -1.6 },
      }),
    ])
    const names = sites.map((s) => s.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names.some((n) => n.includes('(Villejean)'))).toBe(true)
  })
})

describe('rattachement des sites', () => {
  it('le plus gros site d’une commune garde le nom simple, un IEP reçoit « Sciences Po »', () => {
    const base = {
      etablissement_uai: '0340001A',
      siege_lib: 'Université de Exemple',
      com_nom: 'Exemple',
      dep_id: 'D034',
    }
    const sites = buildSites(
      [
        impl({ ...base, uai: '0340002B' }),
        impl({
          ...base,
          uai: '0340003C',
          implantation_lib: 'UFR DROIT',
          bcnag_n_nature_uai_libelle_editi: 'Unité de formation et de recherche (hors santé)',
        }),
        impl({
          ...base,
          uai: '0340004D',
          implantation_lib: 'UFR LETTRES',
          bcnag_n_nature_uai_libelle_editi: 'Unité de formation et de recherche (hors santé)',
          coordonnees: { lat: 48.9, lon: 2.4 },
        }),
        impl({
          ...base,
          uai: '0340005E',
          implantation_lib: 'INSTITUT D’ETUDES POLITIQUES D’EXEMPLE',
          bcnag_n_nature_uai_libelle_editi: "Institut d'études politiques",
          coordonnees: { lat: 49.5, lon: 3 },
        }),
      ],
      [
        {
          uai: '0349999Z',
          uo_lib: 'Université de Exemple',
          coordonnees: { lat: 48.85, lon: 2.35 },
          com_nom: 'Exemple',
          code_postal_uai: null,
          dep_id: 'D034',
          aca_nom: null,
        },
      ],
    )
    const names = sites.map((s) => s.name)
    expect(names).toContain('Université de Exemple – Exemple')
    expect(names.some((n) => n.endsWith('(Sciences Po)'))).toBe(true)
    // pas de doublon « Université de Exemple » issu de l'établissement principal
    expect(names).not.toContain('Université de Exemple')
  })
})
