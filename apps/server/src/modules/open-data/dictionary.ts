/**
 * The data dictionary of the open data: what every view, column and value means. One source for
 * the JSON, the CSV and the plain-text versions served by the API, and a test checks that every
 * published column is documented (so the dictionary cannot drift from the data).
 * French on purpose: it describes the published French contract.
 */
import { ATTRIBUTION, LICENCE, type View } from './format.ts'

export interface ColumnDoc {
  nom: string
  description: string
  /** The allowed values and what each means. */
  valeurs?: Record<string, string>
}

export interface ViewDoc {
  vue: View
  description: string
  colonnes: ColumnDoc[]
}

const STATUT = {
  bloque:
    "L'entrée est bloquée. Couvre aussi les établissements fermés ou passés en distanciel à cause du mouvement.",
  filtrant: "Barrage filtrant : l'entrée est partielle.",
  leve: 'Le blocus est terminé.',
}

/** The category to map: the statuses plus the "mobilisation" kind. */
const CATEGORIE = {
  bloque: STATUT.bloque,
  filtrant: STATUT.filtrant,
  mobilisation:
    "Rassemblement, mobilisation ou incident signalé devant l'établissement, SANS que la source dise que l'entrée est bloquée. Jamais comptée comme « bloque ». N'existe que lorsque les niveaux de confiance sont activés.",
  leve: STATUT.leve,
}

const CONFIANCE = {
  confirmé:
    "Le texte source dit que l'établissement est bloqué ou fermé (relecture par un second avis automatique), ou c'est un signalement sur place validé.",
  'non jugé': 'Pas encore relu (page illisible, par exemple). Compté comme confirmé en attendant.',
  mobilisation:
    "Il se passe quelque chose (rassemblement, incident, cas peu clair) mais le texte ne dit pas que l'entrée est bloquée.",
  '(vide)':
    'Les niveaux de confiance ne sont pas activés : tous les signalements sont comptés de la même façon.',
}

const ORIGINE = {
  presse: 'Un média : site d’actualité, flux RSS, compte de média sur Bluesky.',
  syndicat: 'Une organisation (syndicat, collectif) déclarée comme telle.',
  collecteur:
    'Une autre source collectée automatiquement (par exemple des canaux Telegram de collectifs).',
  utilisateur:
    "Un signalement fait sur place par un visiteur via le formulaire du site (position vérifiée à moins de 2 km, relu par l'équipe). Pas de lien de source.",
}

const NIVEAU = { lycee: 'Lycée.', superieur: 'Enseignement supérieur (faculté, école).' }

const CERTITUDE = {
  haute: 'Fait affirmé clairement et au présent dans la source.',
  moyenne: 'Fait probable.',
  faible: 'Appel à bloquer, rumeur, conditionnel, futur ou fait ancien.',
}

const school: ColumnDoc[] = [
  { nom: 'uai', description: "Identifiant de l'établissement (UAI, répertoire national)." },
  { nom: 'nom', description: "Nom de l'établissement." },
  { nom: 'commune', description: 'Commune.' },
  { nom: 'departement', description: 'Code du département.' },
  { nom: 'academie', description: 'Académie.' },
  { nom: 'niveau', description: 'Lycée ou enseignement supérieur.', valeurs: NIVEAU },
]

const zone = (name: 'departement' | 'academie'): ColumnDoc[] => [
  { nom: name, description: name === 'departement' ? 'Code du département.' : 'Académie.' },
  { nom: 'etablissements', description: 'Établissements signalés dans la zone depuis le début.' },
  { nom: 'lycees', description: 'Dont lycées.' },
  { nom: 'facs', description: 'Dont facs et écoles.' },
  { nom: 'premier_jour', description: 'Premier jour (AAAA-MM-JJ, Paris) avec un signalement.' },
  { nom: 'dernier_jour', description: 'Dernier jour (AAAA-MM-JJ, Paris) avec un signalement.' },
  { nom: 'signalements', description: 'Nombre de signalements.' },
  { nom: 'bloques_maintenant', description: 'Établissements bloqués à cet instant.' },
  { nom: 'filtrants_maintenant', description: 'Établissements en barrage filtrant à cet instant.' },
  {
    nom: 'mobilises',
    description:
      'Établissements avec seulement une mobilisation signalée (en plus des précédents ; 0 si les niveaux de confiance sont désactivés).',
  },
]

export const DICTIONARY: ViewDoc[] = [
  {
    vue: 'etablissements',
    description:
      'Une ligne par établissement signalé au moins une fois. Formats : json, csv, geojson (lat et lng deviennent geometry.coordinates = [lng, lat]).',
    colonnes: [
      ...school,
      { nom: 'lat', description: 'Latitude (WGS84).' },
      { nom: 'lng', description: 'Longitude (WGS84).' },
      {
        nom: 'premier_blocage',
        description: 'Premier jour (AAAA-MM-JJ, Paris) où un blocage ou un barrage a été signalé.',
      },
      {
        nom: 'dernier_signalement',
        description: 'Date et heure (UTC, ISO 8601) du signalement le plus récent.',
      },
      {
        nom: 'dernier_statut',
        description: 'Statut du signalement le plus récent.',
        valeurs: STATUT,
      },
      {
        nom: 'statut_direct',
        description: "Statut en cours à l'instant du téléchargement ; vide si plus rien de récent.",
        valeurs: STATUT,
      },
      {
        nom: 'categorie',
        description:
          'La valeur à utiliser pour cartographier : le dernier statut, ou « mobilisation » si les signalements ne sont que des mobilisations sans blocage.',
        valeurs: CATEGORIE,
      },
      { nom: 'signalements', description: 'Nombre de signalements.' },
      {
        nom: 'sites_sources',
        description: 'Nombre de sites différents (hors signalements sur place).',
      },
      {
        nom: 'origines',
        description:
          "TOUTES les origines des signalements de l'établissement, séparées par « , » : « presse, utilisateur » veut dire au moins un signalement de presse ET un sur place. Ce ne sont pas des catégories à part : ce sont plusieurs origines. (Avant, la séparation était une simple espace.)",
        valeurs: ORIGINE,
      },
      {
        nom: 'confiance',
        description:
          "Résume tous les signalements de l'établissement : « confirmé » dès qu'un l'est, sinon « non jugé », sinon « mobilisation ».",
        valeurs: CONFIANCE,
      },
    ],
  },
  {
    vue: 'signalements',
    description: 'Une ligne par signalement validé. Formats : json, csv.',
    colonnes: [
      { nom: 'observe_le', description: 'Moment du fait signalé (UTC, ISO 8601).' },
      { nom: 'jour', description: 'Jour du fait (AAAA-MM-JJ, heure de Paris).' },
      ...school,
      { nom: 'statut', description: 'Statut déclaré.', valeurs: STATUT },
      {
        nom: 'categorie',
        description:
          'La valeur à utiliser pour cartographier : le statut, ou « mobilisation » si le signalement est une mobilisation sans blocage.',
        valeurs: CATEGORIE,
      },
      {
        nom: 'origine',
        description: "D'où vient le signalement (une seule valeur).",
        valeurs: ORIGINE,
      },
      {
        nom: 'site_source',
        description: 'Domaine de la source (vide pour un signalement sur place).',
      },
      {
        nom: 'lien_source',
        description: "Adresse de l'article ou du message (vide pour un signalement sur place).",
      },
      {
        nom: 'certitude',
        description:
          'À quel point le fait est affirmé clairement et au présent (vide pour un signalement sur place).',
        valeurs: CERTITUDE,
      },
      { nom: 'confiance', description: 'Niveau de confiance du signalement.', valeurs: CONFIANCE },
    ],
  },
  {
    vue: 'jours',
    description:
      'Une ligne par jour (heure de Paris). Un établissement est compté une fois par jour.',
    colonnes: [
      { nom: 'jour', description: 'Jour (AAAA-MM-JJ, heure de Paris).' },
      { nom: 'etablissements', description: 'Établissements signalés ce jour-là.' },
      { nom: 'bloques', description: 'Dont bloqués.' },
      { nom: 'filtrants', description: 'Dont en barrage filtrant.' },
      { nom: 'leves', description: 'Dont blocus levés.' },
      { nom: 'departements', description: 'Départements touchés.' },
      { nom: 'lycees', description: 'Lycées signalés.' },
      { nom: 'facs', description: 'Facs et écoles signalées.' },
      { nom: 'signalements', description: 'Nombre de signalements.' },
      { nom: 'via_presse', description: 'Établissements signalés par la presse.' },
      { nom: 'via_organisations', description: 'Établissements signalés par des organisations.' },
      {
        nom: 'via_autres_sources',
        description: 'Établissements signalés par une autre source collectée.',
      },
      {
        nom: 'via_signalements_sur_place',
        description: 'Établissements signalés sur place par des visiteurs.',
      },
      {
        nom: 'mobilises',
        description:
          'Établissements avec seulement une mobilisation signalée ce jour-là (en plus des précédents).',
      },
      { nom: 'mobilises_lycees', description: 'Dont lycées.' },
      { nom: 'mobilises_facs', description: 'Dont facs et écoles.' },
    ],
  },
  {
    vue: 'departements',
    description: 'Une ligne par département.',
    colonnes: zone('departement'),
  },
  {
    vue: 'academies',
    description: 'Une ligne par académie.',
    colonnes: zone('academie'),
  },
  {
    vue: 'resume',
    description:
      'Un objet : premier_jour, dernier_jour, signalements, etablissements, departements, facs, sites_sources, mobilises, pic (jour du maximum), en_ce_moment (bloques, filtrants), origines (une entrée par origine : signalements, etablissements).',
    colonnes: [],
  },
]

/** The dictionary as JSON, the shape the API serves. */
export const dictionaryJson = () => ({
  licence: LICENCE,
  attribution: ATTRIBUTION,
  avertissement:
    "Ce sont des ÉTABLISSEMENTS SIGNALÉS (par la presse, des organisations, des collectes automatiques ou des visiteurs sur place), pas un recensement exhaustif. Chaque signalement garde le lien de sa source ; un signalement ne prouve pas à lui seul qu'un établissement est bloqué (voir « confiance »). Les jours (AAAA-MM-JJ) sont ceux de Paris ; les dates et heures complètes sont en UTC (ISO 8601).",
  vues: DICTIONARY,
})

/** One row per column: for a spreadsheet. */
export function dictionaryRows(): Array<Record<string, string>> {
  return DICTIONARY.flatMap((v) =>
    v.colonnes.map((c) => ({
      vue: v.vue,
      colonne: c.nom,
      description: c.description,
      valeurs: c.valeurs
        ? Object.entries(c.valeurs)
            .map(([k, d]) => `${k} : ${d}`)
            .join(' | ')
        : '',
    })),
  )
}

/** The plain-text version, for a person reading it in a browser. */
export function dictionaryText(): string {
  const j = dictionaryJson()
  const out: string[] = [
    'MANIFESTE - DICTIONNAIRE DES DONNÉES OUVERTES',
    '==============================================',
    '',
    `Licence : ${j.licence} (réutilisation libre, avec mention « ${j.attribution} »).`,
    'Accès   : https://manifeste.pandeo.fr/api/open-data?view=<vue>&format=<format>',
    '          vues : summary (resume), days (jours), departments (departements), academies, schools (etablissements), reports (signalements)',
    '          formats : json (par défaut), csv (séparateur « ; », UTF-8), geojson (établissements seulement)',
    '          ce dictionnaire : /api/open-data?view=dictionary (&format=json, csv ou txt)',
    "          l'ancien chemin /api/donnees?vue=... redirige vers /api/open-data",
    '',
    j.avertissement,
  ]
  for (const v of DICTIONARY) {
    out.push('', '', `VUE « ${v.vue} »`, '-'.repeat(v.vue.length + 7), v.description, '')
    for (const c of v.colonnes) {
      out.push(`  ${c.nom}`.padEnd(26) + c.description)
      for (const [k, d] of Object.entries(c.valeurs ?? {})) out.push(`${''.padEnd(28)}${k} : ${d}`)
    }
  }
  out.push('', '', 'Contact : contact@pandeo.fr', '')
  return out.join('\n')
}
