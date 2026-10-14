// Tweet templates: each one turns the figures of a range into a text and tells the image
// renderer what to draw. Pure functions, no I/O, so they are easy to test.
import { RANGE_LABEL, topDepartments, type Figures, type TweetData } from './figures'
import { dayLabel, num, plural } from './text'

export type CardKind = 'curve' | 'numbers' | 'departments' | 'sources' | 'appeal'

export interface TemplateContext {
  data: TweetData
  figures: Figures
}

export interface Template {
  id: string
  label: string
  hint: string
  card: CardKind
  /** The range matters (else the template ignores it and the picker says so). */
  usesRange: boolean
  body(ctx: TemplateContext): string
}

const since = (f: Figures): string =>
  f.firstDay ? `depuis le ${dayLabel(f.firstDay)}` : 'depuis le début'

/** "aujourd'hui", "sur les 7 derniers jours", "depuis le 14 septembre". */
export function whenPhrase(f: Figures): string {
  if (f.range === 'today') return "aujourd'hui"
  if (f.range === '7d') return 'sur les 7 derniers jours'
  if (f.range === '30d') return 'sur les 30 derniers jours'
  return since(f)
}

/** The headline sentence of a range, honest about what the number is. */
export function headline(f: Figures): string {
  const schools = `${num(f.schools)} ${plural(f.schools, 'établissement signalé', 'établissements signalés')}`
  if (f.range === 'all') return `${schools} bloqués ou filtrants ${since(f)}`
  if (f.range === 'today')
    return `${schools} bloqué${f.schools > 1 ? 's' : ''} ou filtrant${f.schools > 1 ? 's' : ''} aujourd'hui`
  return f.peak
    ? `Pic de ${num(f.peak.etablissements)} ${plural(f.peak.etablissements, 'établissement signalé', 'établissements signalés')} en une journée (${dayLabel(f.peak.jour)}) ${whenPhrase(f)}`
    : `Aucun signalement ${whenPhrase(f)}`
}

export const TEMPLATES: ReadonlyArray<Template> = [
  {
    id: 'bilan',
    label: 'Bilan',
    hint: 'Chiffres clés de la période',
    card: 'numbers',
    usesRange: true,
    body: ({ figures: f }) =>
      [
        `📍 ${headline(f)}.`,
        `${num(f.departments)} ${plural(f.departments, 'département', 'départements')} · ${num(f.reports)} ${plural(f.reports, 'signalement', 'signalements')}, chacun avec sa source.`,
      ].join('\n'),
  },
  {
    id: 'courbe',
    label: 'Courbe',
    hint: 'Évolution jour par jour',
    card: 'curve',
    usesRange: true,
    body: ({ figures: f }) =>
      [
        `📈 Établissements signalés par jour, ${f.range === 'today' ? 'sur les 14 derniers jours' : whenPhrase(f)}.`,
        f.peak ? `Pic : ${num(f.peak.etablissements)} le ${dayLabel(f.peak.jour)}.` : '',
      ]
        .filter(Boolean)
        .join('\n'),
  },
  {
    id: 'maintenant',
    label: 'En ce moment',
    hint: 'Bloqués et filtrants à cet instant',
    card: 'numbers',
    usesRange: false,
    body: ({ figures: f }) =>
      `🔴 En ce moment : ${num(f.nowBlocked)} ${plural(f.nowBlocked, 'établissement bloqué', 'établissements bloqués')} et ${num(f.nowFiltering)} en filtrage.\nCarte en direct, chaque point avec sa source :`,
  },
  {
    id: 'departements',
    label: 'Départements',
    hint: 'Classement depuis le début',
    card: 'departments',
    usesRange: false,
    body: ({ data }) => {
      const top = topDepartments(data.departements, 3)
      if (top.length === 0) return 'Où ça bouge le plus ? La carte par département :'
      return `🗺️ Les départements les plus touchés depuis le début : ${top
        .map((t) => `${t.name} (${num(t.schools)})`)
        .join(', ')}.\nLe classement complet, ouvert à tous :`
    },
  },
  {
    id: 'sources',
    label: 'Sources',
    hint: "D'où viennent les signalements",
    card: 'sources',
    usesRange: false,
    body: ({ data }) => {
      const total = data.resume.signalements
      const press = data.resume.origines.find((o) => o.origine === 'presse')?.signalements ?? 0
      const share = total > 0 ? Math.round((press / total) * 100) : 0
      return `🔎 Chaque point de la carte renvoie vers sa source.${total > 0 ? ` Sur ${num(total)} signalements, ${share} % viennent de la presse.` : ''}\nMéthode et limites expliquées, données libres (CC BY 4.0) :`
    },
  },
  {
    id: 'appel',
    label: 'Appel à signaler',
    hint: 'Sans chiffres : invite à signaler',
    card: 'appeal',
    usesRange: false,
    body: () =>
      'Un blocage dans ton lycée ou ta fac ? Signale-le en 30 secondes, sans compte. Il apparaît sur la carte après vérification.',
  },
]

export const templateById = (id: string): Template =>
  TEMPLATES.find((t) => t.id === id) ?? (TEMPLATES[0] as Template)

/** The title shown on the picture. */
export function cardTitle(t: Template, f: Figures): string {
  return t.usesRange ? RANGE_LABEL[f.range] : t.label
}
