import { describe, expect, it } from 'vitest'
import {
  checkDate,
  dateCandidates,
  parseArticle,
  schoolMention,
  sentencesAbout,
} from '../scripts/audit-reports-lib'

describe('parseArticle', () => {
  it('lit le titre, la date de publication et les paragraphes', () => {
    const html = `<html><head><title>Blocus &amp; colère</title>
      <meta property="article:published_time" content="2026-10-04T19:06:00+02:00"></head>
      <body><nav><p>Menu de navigation à ignorer complètement</p></nav>
      <p>Le lycée Fustel de Coulanges est bloqué ce lundi matin par des élèves.</p>
      <p>court</p></body></html>`
    const a = parseArticle(html)
    expect(a.title).toBe('Blocus & colère')
    expect(a.published).toBe('2026-10-04T19:06:00+02:00')
    expect(a.text).toBe('Le lycée Fustel de Coulanges est bloqué ce lundi matin par des élèves.')
  })
})

describe('schoolMention', () => {
  const school = { name: 'Lycée polyvalent Emmanuel Mounier', city: 'Grenoble' }
  it('reconnaît le nom', () => {
    expect(schoolMention('Le lycée Mounier à Grenoble est bloqué', school)).toBe('nom')
  })
  it('se contente de la commune quand le nom est absent', () => {
    expect(schoolMention('Plusieurs lycées de Grenoble sont perturbés', school)).toBe('ville')
  })
  it('signale une école absente du texte', () => {
    expect(schoolMention('Blocage à Rennes ce mardi', school)).toBe('non')
  })
})

describe('sentencesAbout', () => {
  it('garde les phrases qui parlent de l’établissement', () => {
    const text = 'Il pleut. Le lycée Mounier est bloqué. Autre sujet.'
    expect(sentencesAbout(text, { name: 'Lycée Mounier', city: 'Grenoble' })).toEqual([
      'Le lycée Mounier est bloqué.',
    ])
  })
})

describe('dateCandidates et checkDate', () => {
  // Dimanche 4 octobre 2026.
  it('un jour de la semaine renvoie au dernier passé et à l’annonce des 3 jours', () => {
    const c = dateCandidates('Cours suspendus ce lundi', '2026-10-04')
    expect(c.has('2026-09-28')).toBe(true)
    expect(c.has('2026-10-05')).toBe(true)
    expect(c.has('2026-10-04')).toBe(false)
  })
  it('lit une date écrite et « hier »', () => {
    const c = dateCandidates('le blocus du 28 septembre, hier encore', '2026-10-04')
    expect(c.has('2026-09-28')).toBe(true)
    expect(c.has('2026-10-03')).toBe(true)
  })
  it('juge le jour retenu', () => {
    const c = dateCandidates('fermés ce lundi', '2026-10-04')
    expect(checkDate('2026-10-05', c)).toEqual({ kind: 'coherent' })
    expect(checkDate('2026-10-04', c)).toMatchObject({ kind: 'incoherent', gapDays: 1 })
    expect(checkDate('2026-10-04', new Set())).toEqual({ kind: 'indetermine' })
  })
})
