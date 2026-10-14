// What a picture shows, as plain data. The canvas renderer (card.ts) only draws this, so the
// choice of numbers, labels and dates is testable without a browser.
import { topDepartments, type Figures, type TweetData } from './figures'
import { cardTitle, headline, type Template } from './templates'
import { dayLabel, num } from './text'

export type Tone = 'bloque' | 'filtrant' | 'neutral'

export interface Stat {
  value: string
  label: string
  tone: Tone
}

export interface Row {
  label: string
  value: number
  display: string
}

export type CardBody =
  | { kind: 'numbers'; stats: Stat[] }
  | {
      kind: 'curve'
      points: Array<{ day: string; value: number }>
      /** Day to highlight (the last one), if any. */
      highlight: string | null
      peak: { day: string; value: number } | null
    }
  | { kind: 'rows'; rows: Row[] }
  | { kind: 'appeal'; line: string }

export interface CardSpec {
  title: string
  subtitle: string
  body: CardBody
  footerRight: string
}

const ORIGIN_LABEL: Record<string, string> = {
  presse: 'Presse',
  syndicat: 'Organisations',
  collecteur: 'Autres sources',
  utilisateur: 'Sur place',
}

export function cardSpec(template: Template, data: TweetData, f: Figures): CardSpec {
  const footerRight = `Données ouvertes · CC BY 4.0 · ${dayLabel(data.today)}`
  const title = cardTitle(template, f)

  switch (template.card) {
    case 'curve':
      return {
        title,
        subtitle:
          f.range === 'today'
            ? 'Établissements signalés par jour · 14 derniers jours'
            : 'Établissements signalés par jour',
        footerRight,
        body: {
          kind: 'curve',
          points: f.curve.map((j) => ({ day: j.jour, value: j.etablissements })),
          highlight: f.range === 'today' ? data.today : null,
          peak: f.peak ? { day: f.peak.jour, value: f.peak.etablissements } : null,
        },
      }
    case 'departments': {
      const rows = topDepartments(data.departements, 8).map((d) => ({
        label: d.name,
        value: d.schools,
        display: num(d.schools),
      }))
      return {
        title,
        subtitle: 'Établissements signalés depuis le début, par département',
        footerRight,
        body: { kind: 'rows', rows },
      }
    }
    case 'sources': {
      const total = data.resume.signalements
      const rows = data.resume.origines
        .filter((o) => o.signalements > 0)
        .sort((a, b) => b.signalements - a.signalements)
        .map((o) => ({
          label: ORIGIN_LABEL[o.origine] ?? o.origine,
          value: o.signalements,
          display: total > 0 ? `${Math.round((o.signalements / total) * 100)} %` : '',
        }))
      return {
        title,
        subtitle: `${num(total)} signalements, chacun avec le lien de sa source`,
        footerRight,
        body: { kind: 'rows', rows },
      }
    }
    case 'appeal':
      return {
        title: 'Un blocage près de chez toi ?',
        subtitle: 'Signale-le en 30 secondes, sans compte',
        footerRight,
        body: { kind: 'appeal', line: 'Chaque signalement est vérifié avant d’apparaître.' },
      }
    case 'numbers':
    default: {
      if (!template.usesRange) {
        return {
          title,
          subtitle: 'À cet instant',
          footerRight,
          body: {
            kind: 'numbers',
            stats: [
              { value: num(f.nowBlocked), label: 'bloqués', tone: 'bloque' },
              { value: num(f.nowFiltering), label: 'en filtrage', tone: 'filtrant' },
            ],
          },
        }
      }
      return {
        title,
        subtitle: headline(f),
        footerRight,
        body: {
          kind: 'numbers',
          stats: [
            {
              value: num(f.schools),
              label: f.schoolsIsPeak
                ? 'établissements (pic sur un jour)'
                : 'établissements signalés',
              tone: 'bloque',
            },
            { value: num(f.departments), label: 'départements', tone: 'neutral' },
            { value: num(f.reports), label: 'signalements sourcés', tone: 'neutral' },
          ],
        },
      }
    }
  }
}
