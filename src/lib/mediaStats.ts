// Onglet admin « Médias » : agrégation des analyses d'articles par média et par propriétaire,
// et constats calculés par des règles explicites (pas par l'IA).

export interface MediaRow {
  url: string
  domain: string
  title: string | null
  published_at: string | null
  about_movement: boolean
  mentions_demands: boolean
  demands: string[]
  voices: string[]
  focus: 'revendications' | 'mobilisation' | 'incidents' | 'mixte'
  incidents: boolean
  police_violence: boolean
  terms: string[]
  tone: 'favorable' | 'neutre' | 'defavorable'
  quote_demands: string | null
  quote_framing: string | null
  /** Longueur du texte lu par l'IA ; null pour les analyses antérieures à cette mesure. */
  text_chars?: number | null
}

/** En dessous, l'IA n'a vu qu'un titre : on ne peut pas dire si les revendications sont exposées. */
export const MIN_TEXT_CHARS = 200
const readable = (r: MediaRow) => r.text_chars == null || r.text_chars >= MIN_TEXT_CHARS

/**
 * Média et propriétaire. Vérifié sur le web le 6 octobre 2026 (CB News, The Media Leader,
 * Autorité de la concurrence, communiqués des groupes) ; les domaines absents s'affichent tels
 * quels, propriétaire « Non renseigné ». Les pourcentages d'actionnariat ne sont volontairement
 * pas affichés : plusieurs ne sont pas publics ou datés.
 * À surveiller (peuvent changer) : Sud Ouest (Rossel en négociation exclusive pour 80 %, fin
 * 2026), 20 Minutes (Rossel à 100 % annoncé en février 2026, clôture non confirmée), Le
 * Parisien (rumeur de vente démentie par LVMH), holding de l'audiovisuel public.
 */
export const OUTLETS: Record<string, { name: string; owner: string }> = {
  // Presse nationale
  'lemonde.fr': {
    name: 'Le Monde',
    owner: "Groupe Le Monde (Fonds pour l'indépendance de la presse)",
  },
  'huffingtonpost.fr': {
    name: 'HuffPost',
    owner: "Groupe Le Monde (Fonds pour l'indépendance de la presse)",
  },
  'nouvelobs.com': {
    name: "L'Obs",
    owner: "Groupe Le Monde (Fonds pour l'indépendance de la presse)",
  },
  'lefigaro.fr': { name: 'Le Figaro', owner: 'Groupe Dassault' },
  'liberation.fr': { name: 'Libération', owner: 'Presse indépendante (fonds de dotation)' },
  'leparisien.fr': { name: 'Le Parisien', owner: 'LVMH (Bernard Arnault)' },
  'lesechos.fr': { name: 'Les Échos', owner: 'LVMH (Bernard Arnault)' },
  'lopinion.fr': { name: "L'Opinion", owner: 'LVMH (Bernard Arnault)' },
  'cnews.fr': { name: 'CNews', owner: 'Groupe Canal+ (Bolloré)' },
  'europe1.fr': { name: 'Europe 1', owner: 'Lagardère / Louis Hachette Group (Bolloré)' },
  'lejdd.fr': { name: 'Le JDD', owner: 'Lagardère / Louis Hachette Group (Bolloré)' },
  'bfmtv.com': { name: 'BFMTV', owner: 'CMA CGM (Rodolphe Saadé)' },
  'rmc.bfmtv.com': { name: 'RMC', owner: 'CMA CGM (Rodolphe Saadé)' },
  'tf1info.fr': { name: 'TF1 Info', owner: 'Groupe TF1 (Bouygues)' },
  'lci.fr': { name: 'LCI', owner: 'Groupe TF1 (Bouygues)' },
  'rtl.fr': { name: 'RTL', owner: 'Groupe M6 (RTL Group / Bertelsmann)' },
  'sudradio.fr': { name: 'Sud Radio', owner: 'Fiducial' },
  'lepoint.fr': { name: 'Le Point', owner: 'Artémis (François Pinault)' },
  'lexpress.fr': { name: "L'Express", owner: 'Alain Weill' },
  'marianne.net': { name: 'Marianne', owner: 'CMI France (Daniel Kretinsky)' },
  'valeursactuelles.com': {
    name: 'Valeurs actuelles',
    owner: 'Valmonde (La Combe, Caude, Stérin)',
  },
  '20minutes.fr': { name: '20 Minutes', owner: 'Groupe Rossel' },
  'la-croix.com': { name: 'La Croix', owner: 'Groupe Bayard (Assomptionnistes)' },
  'mariefrance.fr': { name: 'Marie France', owner: 'Reworld Media' },
  'aufeminin.com': { name: 'Aufeminin', owner: 'Reworld Media' },
  'boursorama.com': { name: 'Boursorama', owner: 'Société Générale' },
  'jeanmarcmorandini.com': {
    name: 'Jean-Marc Morandini',
    owner: 'The Web Family (J.-M. Morandini)',
  },
  'fr.news.yahoo.com': { name: 'Yahoo Actualités', owner: 'Agrégateur (Yahoo)' },
  'actu.orange.fr': { name: 'Orange Actualités', owner: 'Agrégateur (Orange)' },

  // Indépendants, associations, fonds
  'humanite.fr': { name: "L'Humanité", owner: "L'Humanité (PCF, lecteurs, salariés)" },
  'mediapart.fr': { name: 'Mediapart', owner: 'Fonds pour une presse libre' },
  'reporterre.net': { name: 'Reporterre', owner: 'Association La Pile' },
  'basta.media': { name: 'Basta!', owner: 'Association Alter-médias' },
  'streetpress.com': { name: 'StreetPress', owner: 'Indépendant' },
  'blast-info.fr': { name: 'Blast', owner: 'Indépendant' },

  // Service public
  'francetvinfo.fr': { name: 'Franceinfo', owner: 'Service public' },
  'franceinfo.fr': { name: 'Franceinfo', owner: 'Service public' },
  'france3-regions.francetvinfo.fr': { name: 'France 3 Régions', owner: 'Service public' },
  'france3-regions.franceinfo.fr': { name: 'France 3 Régions', owner: 'Service public' },
  'la1ere.franceinfo.fr': { name: 'La 1ère', owner: 'Service public' },
  'la1ere.francetvinfo.fr': { name: 'La 1ère', owner: 'Service public' },
  'francebleu.fr': { name: 'ici (France Bleu)', owner: 'Service public' },
  'ici.fr': { name: 'ici (France Bleu)', owner: 'Service public' },
  'radiofrance.fr': { name: 'Radio France', owner: 'Service public' },
  'franceinter.fr': { name: 'France Inter', owner: 'Service public' },
  'rfi.fr': { name: 'RFI', owner: 'Service public' },
  'france24.com': { name: 'France 24', owner: 'Service public' },
  'arte.tv': { name: 'Arte', owner: 'Service public' },
  'lcp.fr': { name: 'LCP', owner: 'Service public (Assemblée nationale)' },
  'publicsenat.fr': { name: 'Public Sénat', owner: 'Service public (Sénat)' },

  // Presse régionale
  'ouest-france.fr': { name: 'Ouest-France', owner: 'Groupe Sipa Ouest-France' },
  'actu.fr': { name: 'Actu.fr', owner: 'Groupe Sipa Ouest-France' },
  'hitwest.ouest-france.fr': { name: 'Hit West', owner: 'Groupe 1981' },
  'lavoixdunord.fr': { name: 'La Voix du Nord', owner: 'Groupe Rossel' },
  'courrier-picard.fr': { name: 'Courrier picard', owner: 'Groupe Rossel' },
  'lest-eclair.fr': { name: "L'Est-Éclair", owner: 'Groupe Rossel' },
  'ladepeche.fr': { name: 'La Dépêche du Midi', owner: 'Groupe La Dépêche (Baylet)' },
  'midilibre.fr': { name: 'Midi Libre', owner: 'Groupe La Dépêche (Baylet)' },
  'lindependant.fr': { name: "L'Indépendant", owner: 'Groupe La Dépêche (Baylet)' },
  'nrpyrenees.fr': {
    name: 'La Nouvelle République des Pyrénées',
    owner: 'Groupe La Dépêche (Baylet)',
  },
  'centrepresseaveyron.fr': { name: 'Centre Presse Aveyron', owner: 'Groupe La Dépêche (Baylet)' },
  'sudouest.fr': { name: 'Sud Ouest', owner: 'Groupe Sud Ouest' },
  'charentelibre.fr': { name: 'Charente Libre', owner: 'Groupe Sud Ouest' },
  'dordognelibre.fr': { name: 'Dordogne Libre', owner: 'Groupe Sud Ouest' },
  'larepubliquedespyrenees.fr': { name: 'La République des Pyrénées', owner: 'Groupe Sud Ouest' },
  'lamontagne.fr': { name: 'La Montagne', owner: 'Groupe Centre France (Fondation Varenne)' },
  'larep.fr': {
    name: 'La République du Centre',
    owner: 'Groupe Centre France (Fondation Varenne)',
  },
  'lechorepublicain.fr': {
    name: "L'Écho républicain",
    owner: 'Groupe Centre France (Fondation Varenne)',
  },
  'lyonne.fr': { name: "L'Yonne républicaine", owner: 'Groupe Centre France (Fondation Varenne)' },
  'lanouvellerepublique.fr': { name: 'La Nouvelle République', owner: 'Groupe NR' },
  'leprogres.fr': { name: 'Le Progrès', owner: 'EBRA (Crédit Mutuel)' },
  'ledauphine.com': { name: 'Le Dauphiné libéré', owner: 'EBRA (Crédit Mutuel)' },
  'estrepublicain.fr': { name: "L'Est républicain", owner: 'EBRA (Crédit Mutuel)' },
  'dna.fr': { name: 'DNA', owner: 'EBRA (Crédit Mutuel)' },
  'lalsace.fr': { name: "L'Alsace", owner: 'EBRA (Crédit Mutuel)' },
  'republicain-lorrain.fr': { name: 'Le Républicain lorrain', owner: 'EBRA (Crédit Mutuel)' },
  'vosgesmatin.fr': { name: 'Vosges Matin', owner: 'EBRA (Crédit Mutuel)' },
  'bienpublic.com': { name: 'Le Bien public', owner: 'EBRA (Crédit Mutuel)' },
  'lejsl.com': { name: 'Le JSL', owner: 'EBRA (Crédit Mutuel)' },
  'letelegramme.fr': { name: 'Le Télégramme', owner: 'ADVENN (ex-Groupe Télégramme)' },
  'laprovence.com': { name: 'La Provence', owner: 'CMA CGM (Rodolphe Saadé)' },
  'corsematin.com': { name: 'Corse-Matin', owner: 'CMA CGM (Rodolphe Saadé)' },
  'nicematin.com': { name: 'Nice-Matin', owner: 'Xavier Niel' },
  'varmatin.com': { name: 'Var-Matin', owner: 'Xavier Niel' },
  'franceguyane.fr': { name: 'France-Guyane', owner: 'Xavier Niel' },
  'guadeloupe.franceantilles.fr': { name: 'France-Antilles Guadeloupe', owner: 'Xavier Niel' },
}

export const UNKNOWN_OWNER = 'Non renseigné'

/** Sites régionaux d'un groupe (*.maville.com, *.ouest-france.fr) : même propriétaire. */
const FAMILIES: Array<[RegExp, string]> = [
  [/(^|\.)maville\.com$/, 'Groupe Sipa Ouest-France'],
  [/(^|\.)ouest-france\.fr$/, 'Groupe Sipa Ouest-France'],
  [/(^|\.)francetvinfo\.fr$/, 'Service public'],
]

export function outletOf(domain: string): { name: string; owner: string } {
  const d = domain.replace(/^www\./, '')
  const known = OUTLETS[d]
  if (known) return known
  const family = FAMILIES.find(([re]) => re.test(d))
  return { name: d, owner: family ? family[1] : UNKNOWN_OWNER }
}

export interface OutletStats {
  key: string
  name: string
  owner: string
  articles: number
  /** Parts (0 à 1) sur les articles qui parlent de la mobilisation. */
  demands: number
  /** Articles sur lesquels `demands` est calculé (ceux dont l'IA a lu plus qu'un titre). */
  demandsBase: number
  studentVoices: number
  officialVoices: number
  incidentsFocus: number
  incidents: number
  policeViolence: number
  favorable: number
  defavorable: number
  /** Mots employés, du plus fréquent au moins fréquent. */
  terms: Array<[string, number]>
  badges: Badge[]
}

export interface Badge {
  id: string
  label: string
  tone: 'good' | 'warn' | 'poor'
  /** La règle, affichée au survol. */
  rule: string
}

/** Nombre d'articles minimal pour afficher un constat (en dessous, trop fragile). */
export const MIN_ARTICLES_BADGE = 15

/** Constats calculés par des règles simples, à partir de MIN_ARTICLES_BADGE articles. */
export function badgesFor(s: Omit<OutletStats, 'badges' | 'key'>): Badge[] {
  if (s.articles < MIN_ARTICLES_BADGE) return []
  const out: Badge[] = []
  const pct = (x: number) => `${Math.round(x * 100)} %`
  const demandsKnown = s.demandsBase >= MIN_ARTICLES_BADGE
  if (demandsKnown && s.incidentsFocus >= 0.5 && s.demands <= 0.25)
    out.push({
      id: 'degats',
      label: 'Peu de revendications, surtout des incidents',
      tone: 'poor',
      rule: `Sur ${s.articles} articles : angle « incidents » dans ${pct(s.incidentsFocus)}, revendications citées dans ${pct(s.demands)} des ${s.demandsBase} dont l'IA a lu plus qu'un titre (règle : ≥ 50 % et ≤ 25 %).`,
    })
  if (s.officialVoices >= 0.5 && s.studentVoices <= 0.2)
    out.push({
      id: 'officiel',
      label: 'Surtout la parole officielle',
      tone: 'poor',
      rule: `Sur ${s.articles} articles : police, préfecture ou direction s'expriment dans ${pct(s.officialVoices)}, les lycéens dans ${pct(s.studentVoices)} (règle : ≥ 50 % et ≤ 20 %).`,
    })
  if (demandsKnown && s.demands >= 0.6)
    out.push({
      id: 'revendications',
      label: 'Revendications souvent citées',
      tone: 'good',
      rule: `Sur ${s.demandsBase} articles dont l'IA a lu plus qu'un titre : revendications citées dans ${pct(s.demands)} (règle : ≥ 60 %).`,
    })
  if (s.studentVoices >= 0.5)
    out.push({
      id: 'parole',
      label: 'Parole aux lycéens fréquente',
      tone: 'good',
      rule: `Sur ${s.articles} articles : lycéens cités dans ${pct(s.studentVoices)} (règle : ≥ 50 %).`,
    })
  if (out.length === 0 && s.incidentsFocus >= 0.35)
    out.push({
      id: 'incidents',
      label: 'Penche vers les incidents',
      tone: 'warn',
      rule: `Sur ${s.articles} articles : angle « incidents » dans ${pct(s.incidentsFocus)} (règle : ≥ 35 %).`,
    })
  return out
}

const OFFICIAL = new Set(['police_prefecture', 'direction_rectorat'])

/** Regroupe par média (`by: 'outlet'`) ou par propriétaire (`by: 'owner'`). */
export function aggregate(rows: ReadonlyArray<MediaRow>, by: 'outlet' | 'owner'): OutletStats[] {
  const groups = new Map<string, MediaRow[]>()
  for (const r of rows) {
    if (!r.about_movement) continue
    const o = outletOf(r.domain)
    const key = by === 'owner' ? o.owner : r.domain.replace(/^www\./, '')
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  return [...groups]
    .map(([key, list]) => {
      const n = list.length
      const share = (f: (r: MediaRow) => boolean) => list.filter(f).length / n
      const readableList = list.filter(readable)
      const termCount = new Map<string, number>()
      for (const r of list) for (const t of r.terms) termCount.set(t, (termCount.get(t) ?? 0) + 1)
      const o = by === 'owner' ? { name: key, owner: key } : outletOf(key)
      const base = {
        name: o.name,
        owner: o.owner,
        articles: n,
        demands: readableList.length
          ? readableList.filter((r) => r.mentions_demands).length / readableList.length
          : 0,
        demandsBase: readableList.length,
        studentVoices: share((r) => r.voices.includes('lyceens')),
        officialVoices: share((r) => r.voices.some((v) => OFFICIAL.has(v))),
        incidentsFocus: share((r) => r.focus === 'incidents'),
        incidents: share((r) => r.incidents),
        policeViolence: share((r) => r.police_violence),
        favorable: share((r) => r.tone === 'favorable'),
        defavorable: share((r) => r.tone === 'defavorable'),
        terms: [...termCount].sort((a, b) => b[1] - a[1]),
      }
      return { key, ...base, badges: badgesFor(base) }
    })
    .sort(
      (a, b) =>
        Number(a.owner === UNKNOWN_OWNER && by === 'owner') -
          Number(b.owner === UNKNOWN_OWNER && by === 'owner') ||
        b.articles - a.articles ||
        a.name.localeCompare(b.name, 'fr'),
    )
}

/** Revendications les plus citées, toutes sources confondues. */
export function topDemands(rows: ReadonlyArray<MediaRow>, limit = 12): Array<[string, number]> {
  const count = new Map<string, number>()
  for (const r of rows) {
    if (!r.about_movement) continue
    for (const d of new Set(r.demands.map((x) => x.toLowerCase().trim()))) {
      if (d) count.set(d, (count.get(d) ?? 0) + 1)
    }
  }
  return [...count].sort((a, b) => b[1] - a[1]).slice(0, limit)
}
