// Export of the "Media" table: PNG image (drawn on a canvas, no library or
// external service) and CSV.
import { MIN_ARTICLES_BADGE, type Badge, type OutletStats } from './mediaStats'

export interface ExportMeta {
  /** E.g. "30 derniers jours". */
  period: string
  by: 'outlet' | 'owner'
  /** Threshold applied (minimum articles per outlet). */
  minArticles: number
  /** Generation date (Paris time). */
  generatedAt: Date
}

const pct = (x: number) => `${Math.round(x * 100)} %`
const dateFmt = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'Europe/Paris',
})

function csvCell(v: string | number): string {
  const s = String(v)
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** CSV (";" separator, opens directly in French-locale Excel). */
export function mediaCsv(stats: ReadonlyArray<OutletStats>, by: 'outlet' | 'owner'): string {
  const head = [
    by === 'owner' ? 'Propriétaire' : 'Média',
    ...(by === 'owner' ? [] : ['Propriétaire']),
    'Articles',
    'Revendications citées (%)',
    'Parole aux lycéens (%)',
    'Parole officielle (%)',
    'Angle incidents (%)',
    'Violences policières évoquées (%)',
    'Ton favorable (%)',
    'Ton défavorable (%)',
    'Constats',
    'Mots employés',
  ]
  const n = (x: number) => Math.round(x * 100)
  const rows = stats.map((s) => [
    s.name,
    ...(by === 'owner' ? [] : [s.owner]),
    s.articles,
    n(s.demands),
    n(s.studentVoices),
    n(s.officialVoices),
    n(s.incidentsFocus),
    n(s.policeViolence),
    n(s.favorable),
    n(s.defavorable),
    s.badges.map((b) => b.label).join(' | '),
    s.terms.map(([t, c]) => `${t} (${c})`).join(', '),
  ])
  const BOM = String.fromCharCode(0xfeff)
  return `${BOM}${[head, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n')}\r\n`
}

const C = {
  bg: '#07090d',
  row: '#0d1117',
  line: '#232a36',
  fg: '#eef0f4',
  muted: '#9aa3b2',
  good: '#30d158',
  warn: '#ff9f0a',
  poor: '#ff453a',
}
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif'
const W = 2200
const PAD = 56
const ROW_H = 128
const HEAD_H = 214
const FOOT_H = 120
const COL = { name: PAD, articles: 440, bars: [570, 780, 990, 1200], tone: 1420, badges: 1600 }
const BAR_W = 170
const BADGE_COLOR: Record<Badge['tone'], string> = { good: C.good, warn: C.warn, poor: C.poor }

function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let t = text
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1)
  return `${t}…`
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** PNG image of the table (dark background, 2000 px wide, ×2 for sharpness). */
export function renderMediaPng(stats: ReadonlyArray<OutletStats>, meta: ExportMeta): Promise<Blob> {
  const scale = 2
  const height = HEAD_H + stats.length * ROW_H + FOOT_H
  const canvas = document.createElement('canvas')
  canvas.width = W * scale
  canvas.height = height * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('Canvas indisponible'))
  ctx.scale(scale, scale)
  ctx.textBaseline = 'alphabetic'

  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, W, height)

  // Header
  ctx.fillStyle = C.fg
  ctx.font = `800 46px ${FONT}`
  ctx.fillText('Comment la presse parle de la mobilisation lycéenne', PAD, 82)
  const total = stats.reduce((a, s) => a + s.articles, 0)
  ctx.fillStyle = C.muted
  ctx.font = `400 25px ${FONT}`
  ctx.fillText(
    `${total} articles analysés par IA · ${meta.period} · regroupés par ${meta.by === 'owner' ? 'propriétaire' : 'média'}${meta.minArticles > 1 ? ` · médias avec au moins ${meta.minArticles} articles` : ''}`,
    PAD,
    124,
  )
  // Colonnes
  const headY = 188
  ctx.font = `600 18px ${FONT}`
  ctx.fillStyle = C.muted
  ctx.fillText(meta.by === 'owner' ? 'PROPRIÉTAIRE' : 'MÉDIA', COL.name, headY)
  ctx.fillText('ARTICLES', COL.articles, headY)
  ;['REVENDICATIONS', 'PAROLE LYCÉENS', 'PAROLE OFFICIELLE', 'ANGLE INCIDENTS'].forEach((t, i) =>
    ctx.fillText(t, COL.bars[i] ?? 0, headY),
  )
  ctx.fillText('TON + / −', COL.tone, headY)
  ctx.fillText('CONSTATS', COL.badges, headY)
  ctx.fillStyle = C.line
  ctx.fillRect(PAD, headY + 14, W - 2 * PAD, 2)

  // Lignes
  stats.forEach((s, i) => {
    const y = HEAD_H + i * ROW_H
    if (i % 2 === 0) {
      ctx.fillStyle = C.row
      ctx.fillRect(PAD - 16, y, W - 2 * PAD + 32, ROW_H)
    }
    const mid = y + 44
    ctx.fillStyle = C.fg
    ctx.font = `700 30px ${FONT}`
    ctx.fillText(fit(ctx, s.name, 390), COL.name, mid)
    if (meta.by === 'outlet') {
      ctx.fillStyle = C.muted
      ctx.font = `400 21px ${FONT}`
      ctx.fillText(fit(ctx, s.owner, 390), COL.name, mid + 32)
    }
    ctx.fillStyle = C.fg
    ctx.font = `600 30px ${FONT}`
    ctx.fillText(String(s.articles), COL.articles, mid)

    const bars: Array<[number, string]> = [
      [s.demands, C.good],
      [s.studentVoices, C.good],
      [s.officialVoices, C.warn],
      [s.incidentsFocus, C.warn],
    ]
    bars.forEach(([value, color], k) => {
      const x = COL.bars[k] ?? 0
      ctx.fillStyle = C.fg
      ctx.font = `600 28px ${FONT}`
      ctx.fillText(pct(value), x, mid)
      ctx.fillStyle = C.line
      roundRect(ctx, x, mid + 14, BAR_W, 12, 6)
      ctx.fill()
      ctx.fillStyle = color
      roundRect(ctx, x, mid + 14, Math.max(BAR_W * value, 8), 12, 6)
      ctx.fill()
    })

    ctx.font = `600 26px ${FONT}`
    ctx.fillStyle = C.good
    const fav = pct(s.favorable)
    ctx.fillText(fav, COL.tone, mid)
    let x = COL.tone + ctx.measureText(fav).width
    ctx.fillStyle = C.muted
    ctx.fillText(' / ', x, mid)
    x += ctx.measureText(' / ').width
    ctx.fillStyle = C.poor
    ctx.fillText(pct(s.defavorable), x, mid)

    // Findings: badges on two lines at most (the rest as "+n"), words used below.
    ctx.font = `600 19px ${FONT}`
    let bx = COL.badges
    let line = 0
    const maxX = W - PAD
    let shown = 0
    for (const b of s.badges) {
      const w = ctx.measureText(b.label).width + 26
      if (bx + w > maxX) {
        line++
        bx = COL.badges
      }
      if (line > 1) break
      const by = mid - 30 + line * 44
      ctx.strokeStyle = BADGE_COLOR[b.tone]
      ctx.fillStyle = BADGE_COLOR[b.tone]
      ctx.lineWidth = 2
      roundRect(ctx, bx, by, w, 36, 18)
      ctx.stroke()
      ctx.fillText(b.label, bx + 13, by + 25)
      bx += w + 10
      shown++
    }
    if (shown < s.badges.length) {
      ctx.fillStyle = C.muted
      ctx.fillText(
        `+${s.badges.length - shown}`,
        Math.min(bx, maxX - 40),
        mid - 30 + line * 44 + 25,
      )
    }
    if (s.articles < MIN_ARTICLES_BADGE) {
      ctx.fillStyle = C.muted
      ctx.font = `400 21px ${FONT}`
      ctx.fillText('constats à partir de 15 articles', COL.badges, mid + 2)
    }
    if (s.terms.length) {
      ctx.fillStyle = C.muted
      ctx.font = `400 21px ${FONT}`
      ctx.fillText(
        fit(
          ctx,
          `mots : ${s.terms
            .slice(0, 4)
            .map(([t, n]) => `${t} (${n})`)
            .join(', ')}`,
          W - PAD - COL.badges,
        ),
        COL.badges,
        mid + 74,
      )
    }
  })

  // Pied
  const fy = HEAD_H + stats.length * ROW_H + 44
  ctx.fillStyle = C.muted
  ctx.font = `400 20px ${FONT}`
  ctx.fillText(
    "Analyse automatique du titre et du chapeau des articles (IA) ; les constats sont calculés par des règles chiffrées, pas par l'IA.",
    PAD,
    fy,
  )
  ctx.fillText(`manifeste.pandeo.fr · généré le ${dateFmt.format(meta.generatedAt)}`, PAD, fy + 32)

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Export impossible'))), 'image/png'),
  )
}

/** Downloads a file generated in the browser. */
export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
