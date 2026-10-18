/**
 * Citations the trigram search cannot resolve, and places the directory can never contain.
 *
 * The directory is the French ministry's list of schools, so two kinds of citation never match by
 * name: those of schools abroad (they are not in it: `isForeignPlace`), and those of French
 * institutions cited under a name that is not the directory's ("la Catho d'Angers" for the
 * "Facultés libres de l'Ouest", "Portalis" for a site of the university of Tours). The second kind is
 * a short curated list, each entry checked against the directory by its UAI.
 */
import { normalizeWords, cleanCitation } from './matching.ts'

export interface InstitutionAlias {
  /** Citations (any case, accents or punctuation) this entry answers to. */
  names: readonly string[]
  /** The cited city, when the same words name something else elsewhere. */
  city?: string
  uai: string
}

const words = (s: string) => normalizeWords(cleanCitation(s)).join(' ')

export const INSTITUTION_ALIASES: readonly InstitutionAlias[] = [
  // Facultés libres de l'Ouest (the Catholic university of the West).
  {
    names: ['Catho d’Angers', 'la Catho', 'Université catholique de l’Ouest', 'UCO'],
    city: 'Angers',
    uai: '0490811R',
  },
  // Institut catholique de Lille, whose university is also cited by its former name.
  {
    names: [
      'Université catholique de la capitale des Flandres',
      'Université catholique de Lille',
      'la Catho de Lille',
      'Catho de Lille',
    ],
    city: 'Lille',
    uai: '0590344D',
  },
  // ENSE3 is a school of Grenoble INP.
  { names: ['ENSE3'], city: 'Grenoble', uai: '0381912X' },
  { names: ['Institut de physique'], city: 'Strasbourg', uai: '0673021V' },
  // Portalis: the law and political science site of the university of Tours.
  {
    names: ['Portalis', 'site Portalis', 'Portalis des Deux Lions'],
    city: 'Tours',
    uai: '0371610Z',
  },
  { names: ['bâtiment de Lettres'], city: 'Pau', uai: '0640251A' },
  // The Fouillole campus is the university of the Antilles' site of Pointe-à-Pitre.
  {
    names: ['Université de Fouillole', 'campus de Fouillole', 'Fouillole'],
    city: 'Les Abymes',
    uai: '9710585J',
  },
  // Saint-Jérôme is in the 13th arrondissement of Marseille.
  {
    names: ['IUT de Saint-Jérôme', 'campus Saint-Jérôme', 'faculté Saint-Jérôme'],
    city: 'Marseille',
    uai: '0131878W',
  },
  { names: ['INSPÉ', 'INSPE'], city: 'Rennes', uai: '0353074B' },
  // The directory has "Lycée du Nord (voie professionnelle à Acoua)"; Mayotte is not a commune.
  { names: ['lycée du Nord'], city: 'Mayotte', uai: '9760273T' },
  // Lycée Louis Armand of Villefranche-sur-Saône, in the Lyon press.
  { names: ['Armand', 'lycée Armand'], city: 'Lyon', uai: '0691644M' },
  // Main site of the school (Gif-sur-Yvette); the others are cited with their town.
  { names: ['CentraleSupélec'], uai: '0912341A' },
]

const index = INSTITUTION_ALIASES.flatMap((a) =>
  a.names.map((n) => ({ name: words(n), city: a.city ? words(a.city) : null, uai: a.uai })),
)

/** The UAI of a curated alias for this citation, or null. */
export function findAlias(name: string, city: string | null): string | null {
  const n = words(name)
  const c = city ? words(city) : ''
  const hit = index.find((a) => a.name === n && (a.city === null || a.city === c))
  return hit?.uai ?? null
}

const FOREIGN_CITIES = new Set(
  [
    // Belgium
    'Liège',
    'Bruxelles',
    'Namur',
    'Charleroi',
    'Mons',
    'Gand',
    'Anvers',
    'Louvain',
    'Louvain-la-Neuve',
    'Tournai',
    'Verviers',
    // Germany, Italy, Spain, UK, Switzerland, Luxembourg, Netherlands
    'Berlin',
    'Hambourg',
    'Munich',
    'Francfort',
    'Cologne',
    'Düsseldorf',
    'Stuttgart',
    'Leipzig',
    'Dresde',
    'Brême',
    'Turin',
    'Milan',
    'Rome',
    'Naples',
    'Florence',
    'Bologne',
    'Madrid',
    'Barcelone',
    'Valence',
    'Séville',
    'Lisbonne',
    'Porto',
    'Londres',
    'Édimbourg',
    'Dublin',
    'Genève',
    'Lausanne',
    'Zurich',
    'Berne',
    'Luxembourg',
    'Amsterdam',
    'Rotterdam',
    'Vienne',
    // Elsewhere
    'Montréal',
    'Québec',
    'Ottawa',
    'Dakar',
    'Abidjan',
    'Alger',
    'Tunis',
    'Casablanca',
    'Rabat',
    'Beyrouth',
    'New York',
    'Washington',
  ].map(words),
)

/** Cities that share a name with a French commune: foreign only when the article says so. */
const AMBIGUOUS = new Set(
  ['Valence', 'Vienne', 'Porto', 'Mons', 'Bologne', 'Berne', 'Cologne'].map(words),
)

/**
 * True when the cited city is abroad, so the school cannot be in the directory. A town that is
 * also a French commune (Valence, Vienne) is not decided here.
 */
export function isForeignPlace(city: string | null | undefined): boolean {
  if (!city) return false
  const c = words(city)
  return FOREIGN_CITIES.has(c) && !AMBIGUOUS.has(c)
}
