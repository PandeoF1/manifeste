/**
 * Établissements d'enseignement supérieur (facs, IUT, écoles) pour la carte, à partir de deux jeux
 * de données ouvertes du ministère (data.enseignementsup-recherche.gouv.fr) :
 * - les implantations des établissements publics (une ligne par UFR, IUT, antenne…) : on garde
 *   les lieux d'enseignement et on regroupe ceux d'un même établissement situés à moins de
 *   700 m (« Tolbiac », « Nanterre »… : un blocage concerne un site, pas une UFR) ;
 * - les principaux établissements (publics et privés), pour ceux qui n'ont aucune implantation.
 */
import { z } from 'zod'

/** Natures d'implantation où l'on enseigne (les services communs, bibliothèques… sont écartés). */
export const TEACHING_NATURES = new Set([
  'Université',
  'Unité de formation et de recherche (hors santé)',
  'Unité de formation et de recherche en santé',
  'Institut universitaire de technologie',
  "Composante d'université avec formation diplômante",
  "Antenne délocalisée d'une composante d'université",
  "Antenne délocalisée d'IUT",
  "Ecole d'ingénieurs",
  "Ecole d'ingénieurs publique (hors tutelle MESR) ou privée",
  "Institut d'admininistration des entreprises",
  "Institut d'études politiques",
  "Etablissement public d'enseignement supérieur",
  "Partie délocalisée d'un établissement de l'enseignement supérieur",
  "Ecole supérieure du professorat et de l'éducation",
  "Antenne d'école supérieure du professorat et de l'éducation",
  'Institut universitaire professionnalisé',
  "Institut de préparation à l'administration générale",
  'Institut du travail',
])

/** Deux implantations d'un même établissement plus proches que ça forment un seul site. */
export const SITE_RADIUS_M = 700

const coords = z.object({ lat: z.number(), lon: z.number() })

export const implantationSchema = z.object({
  uai: z.string(),
  etablissement_uai: z.string().nullable(),
  siege_lib: z.string().nullable(),
  implantation_lib: z.string().nullable(),
  bcnag_n_nature_uai_libelle_editi: z.string().nullable(),
  coordonnees: coords.nullable(),
  com_nom: z.string().nullable(),
  code_postal_uai: z.string().nullable(),
  dep_id: z.string().nullable(),
  aca_nom: z.string().nullable(),
})
export type Implantation = z.infer<typeof implantationSchema>

export const principalSchema = z.object({
  uai: z.string().nullable(),
  uo_lib: z.string(),
  coordonnees: coords.nullable(),
  com_nom: z.string().nullable(),
  code_postal_uai: z.string().nullable(),
  dep_id: z.string().nullable(),
  aca_nom: z.string().nullable(),
})
export type Principal = z.infer<typeof principalSchema>

export interface HigherEdSite {
  uai: string
  name: string
  city: string
  postcode: string | null
  department: string | null
  academy: string | null
  lat: number
  lng: number
}

const UAI = /^[0-9]{7}[A-Z]$/

/** « Paris  3e » -> { city: « Paris », district: « Paris 3e » }. */
export function splitCommune(raw: string): { city: string; district: string } {
  const district = raw.replace(/\s+/g, ' ').trim()
  const city = district.replace(/\s+\d+\s?(er|e|ème|eme)$/i, '').trim()
  return { city, district }
}

/** « D059 » -> « 59 », « D02A » -> « 2A », « D971 » -> « 971 ». */
export function departmentCode(depId: string | null): string | null {
  if (!depId) return null
  const c = depId.trim().toUpperCase().replace(/^D/, '')
  return c.length === 3 && c.startsWith('0') ? c.slice(1) : c || null
}

const SMALL_WORDS = new Set([
  'de',
  'du',
  'des',
  'la',
  'le',
  'les',
  'et',
  'en',
  'sur',
  'sous',
  'd',
  'l',
])

/** « ECOLE NATIONALE D'INGENIEURS » -> « École nationale d'ingénieurs » (casse seulement). */
export function titleCase(s: string): string {
  const lower = s.replace(/\s+/g, ' ').trim().toLocaleLowerCase('fr')
  const out = lower.replace(/\p{L}+/gu, (w, offset: number) =>
    offset === 0 || !SMALL_WORDS.has(w) ? w.charAt(0).toLocaleUpperCase('fr') + w.slice(1) : w,
  )
  return out
}

const ACRONYMS: ReadonlyArray<[RegExp, string]> = [
  [/unit[ée] de formation et de recherche( en)?/i, 'UFR'],
  [/institut universitaire de technologie/i, 'IUT'],
  [/institut universitaire professionnalis[ée]/i, 'IUP'],
  [/institut d['’]administration des entreprises/i, 'IAE'],
  [/institut d['’]?[ée]tudes politiques/i, 'IEP'],
  [/universit[ée] /i, 'Univ. '],
]

/** Libellé court d'une implantation pour départager deux sites d'une même commune. */
export function shortLabel(raw: string, max = 36): string {
  let s = titleCase(raw)
  for (const [re, short] of ACRONYMS) s = s.replace(re, short)
  if (s.length > max) {
    s = s.slice(0, max)
    s = s.slice(0, Math.max(s.lastIndexOf(' '), 1))
  }
  return s.replace(/(\s+(de|du|des|la|le|les|et|d'|l'|d’|l’))+$/i, '').trim()
}

/** Noms d'usage des grands sites, ajoutés entre parenthèses : c'est ainsi que la presse les cite. */
const NICKNAMES: ReadonlyArray<{
  siege?: RegExp
  /** Libellé d'une implantation du site (ex. un IEP au sein d'une université). */
  label?: RegExp
  district?: string
  nickname: string
}> = [
  { label: /[ée]tudes? politiques?/i, nickname: 'Sciences Po' },
  { siege: /paris 1\b|panth[ée]on-sorbonne/i, district: 'Paris 13e', nickname: 'Tolbiac' },
  { siege: /paris 1\b|panth[ée]on-sorbonne/i, district: 'Paris 5e', nickname: 'Sorbonne' },
  { siege: /toulouse.*jean[ -]jaur[èe]s|jean[ -]jaur[èe]s/i, nickname: 'Le Mirail' },
  { siege: /rennes 2/i, nickname: 'Villejean' },
  { siege: /paris 8\b/i, nickname: 'Saint-Denis' },
  { siege: /paris 13\b|sorbonne paris nord/i, nickname: 'Villetaneuse' },
  { siege: /paris 3\b|sorbonne nouvelle/i, district: 'Paris 5e', nickname: 'Censier' },
  { siege: /lumi[èe]re lyon 2|lyon 2\b/i, nickname: 'Bron' },
]

interface Candidate {
  uai: string
  siege: string
  siegeUai: string
  label: string
  rank: number
  lat: number
  lon: number
  district: string
  city: string
  postcode: string | null
  department: string | null
  academy: string | null
}

function rankOf(nature: string | null): number {
  if (nature === 'Université') return 0
  if (nature?.startsWith('Institut universitaire de technologie')) return 1
  if (nature?.startsWith("Ecole d'ingénieurs") || nature === "Institut d'études politiques")
    return 2
  return 3
}

function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad)
  const y = (b.lat - a.lat) * rad
  return Math.sqrt(x * x + y * y) * 6_371_000
}

/**
 * Sites à ajouter à la carte : un par lieu d'enseignement d'un établissement, nommé d'après
 * l'établissement et la commune (« Université de Lorraine – Nancy »), et un par établissement
 * principal sans implantation connue. Les UAI sont ceux de l'implantation la plus représentative.
 */
export function buildSites(
  implantations: ReadonlyArray<Implantation>,
  principals: ReadonlyArray<Principal> = [],
): HigherEdSite[] {
  const byEstablishment = new Map<string, Candidate[]>()
  const known = new Set<string>()
  for (const r of implantations) {
    const nature = r.bcnag_n_nature_uai_libelle_editi
    if (!nature || !TEACHING_NATURES.has(nature) || !r.coordonnees || !r.com_nom) continue
    if (!UAI.test(r.uai) || !r.etablissement_uai || !r.siege_lib) continue
    const department = departmentCode(r.dep_id)
    // Hors de France (code 99x) ou sans département : pas sur la carte.
    if (!department || department.startsWith('99')) continue
    const { city, district } = splitCommune(r.com_nom)
    const list = byEstablishment.get(r.etablissement_uai) ?? []
    list.push({
      uai: r.uai,
      siege: r.siege_lib.replace(/\s+/g, ' ').trim(),
      siegeUai: r.etablissement_uai,
      label: r.implantation_lib ?? '',
      rank: rankOf(nature),
      lat: r.coordonnees.lat,
      lon: r.coordonnees.lon,
      district,
      city,
      postcode: r.code_postal_uai,
      department,
      academy: r.aca_nom,
    })
    byEstablishment.set(r.etablissement_uai, list)
    known.add(r.etablissement_uai)
  }

  const sites: HigherEdSite[] = []
  const usedUai = new Set<string>()
  for (const list of byEstablishment.values()) {
    const clusters: Candidate[][] = []
    for (const c of [...list].sort((a, b) => a.rank - b.rank || a.uai.localeCompare(b.uai))) {
      const home = clusters.find((cl) => distanceM(cl[0] as Candidate, c) < SITE_RADIUS_M)
      if (home) home.push(c)
      else clusters.push([c])
    }
    const named = clusters.map((cl) => {
      const rep = cl[0] as Candidate
      return {
        cl,
        rep,
        base: clusters.length === 1 ? rep.siege : `${rep.siege} – ${rep.district}`,
      }
    })
    const count = new Map<string, number>()
    for (const { base } of named) count.set(base, (count.get(base) ?? 0) + 1)
    // Plusieurs sites dans la même commune : le plus gros garde le nom simple (c'est celui qu'on
    // cherche en citant « l'université de Montpellier »), les autres sont précisés.
    const biggest = new Map<string, Candidate>()
    for (const { cl, rep, base } of named) {
      const best = biggest.get(base)
      const bestSize = named.find((x) => x.rep === best)?.cl.length ?? -1
      if (cl.length > bestSize) biggest.set(base, rep)
    }
    // Nom d'usage : au plus gros site de l'établissement (dans l'arrondissement indiqué, s'il y en a un).
    const nicknamed = new Map<Candidate, string>()
    for (const n of NICKNAMES) {
      const pool = named.filter(
        (x) =>
          (!n.siege || n.siege.test(x.rep.siege)) &&
          (!n.label || x.cl.some((c) => n.label?.test(c.label))) &&
          (!n.district || x.rep.district === n.district),
      )
      const main = pool.sort((a, b) => b.cl.length - a.cl.length)[0]
      if (main) nicknamed.set(main.rep, n.nickname)
    }
    for (const { rep, base } of named) {
      if (usedUai.has(rep.uai)) continue
      let name = base
      if ((count.get(base) ?? 0) > 1 && biggest.get(base) !== rep)
        name = `${base} (${shortLabel(rep.label)})`
      const nick = nicknamed.get(rep)
      if (nick && !name.toLowerCase().includes(nick.toLowerCase())) name = `${name} (${nick})`
      usedUai.add(rep.uai)
      sites.push({
        uai: rep.uai,
        name,
        city: rep.city,
        postcode: rep.postcode,
        department: rep.department,
        academy: rep.academy,
        lat: rep.lat,
        lng: rep.lon,
      })
    }
  }

  for (const p of principals) {
    if (!p.uai || !UAI.test(p.uai) || known.has(p.uai) || usedUai.has(p.uai)) continue
    if (!p.coordonnees || !p.com_nom) continue
    // Déjà présent sous un nom de site (« Université de Montpellier – Montpellier ») : un doublon
    // rendrait le rattachement ambigu.
    const label = p.uo_lib.replace(/\s+/g, ' ').trim()
    if (sites.some((s) => s.name === label || s.name.startsWith(`${label} – `))) continue
    usedUai.add(p.uai)
    sites.push({
      uai: p.uai,
      name: p.uo_lib.replace(/\s+/g, ' ').trim(),
      city: splitCommune(p.com_nom).city,
      postcode: p.code_postal_uai,
      department: departmentCode(p.dep_id),
      academy: p.aca_nom,
      lat: p.coordonnees.lat,
      lng: p.coordonnees.lon,
    })
  }
  // Deux sites au même nom : on ajoute l'UAI plutôt que de les laisser indiscernables.
  const seen = new Map<string, number>()
  for (const site of sites) seen.set(site.name, (seen.get(site.name) ?? 0) + 1)
  for (const site of sites)
    if ((seen.get(site.name) ?? 0) > 1) site.name = `${site.name} [${site.uai}]`
  return sites.sort((a, b) => a.name.localeCompare(b.name, 'fr'))
}
