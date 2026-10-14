// Draws a CardSpec on a canvas (1600 x 900, the 16:9 size X shows without cropping) and returns
// a PNG. Same palette as the site's dark theme. No dependency, nothing leaves the browser.
import type { CardBody, CardSpec, Tone } from './card-spec'
import { dayLabel } from './text'

export const CARD_W = 1600
export const CARD_H = 900

const C = {
  bg: '#07090d',
  panel: '#10141b',
  line: '#232a36',
  fg: '#eef0f4',
  muted: '#9aa3b2',
  red: '#ff453a',
  orange: '#ff9f0a',
}
const TONE: Record<Tone, string> = { bloque: C.red, filtrant: C.orange, neutral: C.fg }
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif'
const PAD = 90
const TOP = 250
const BOTTOM = CARD_H - 120

type Ctx = CanvasRenderingContext2D

function fit(ctx: Ctx, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let t = text
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1)
  return `${t}…`
}

/** Wraps `text` on spaces into lines no wider than `maxWidth`. */
function wrap(ctx: Ctx, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line)
      line = word
    } else line = next
  }
  if (line) lines.push(line)
  return lines
}

/** Axis step and top: step 1, 2, 5 or 10 times a power of ten, so every label is a whole number. */
export function niceAxis(value: number): { step: number; max: number } {
  const raw = Math.max(value, 1) / 4
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow
  return {
    step: Math.max(step, 1),
    max: Math.ceil(value / Math.max(step, 1)) * Math.max(step, 1) || 4,
  }
}

function header(ctx: Ctx, spec: CardSpec) {
  ctx.fillStyle = C.red
  ctx.fillRect(PAD, 70, 14, 56)
  ctx.fillStyle = C.fg
  ctx.font = `900 44px ${FONT}`
  ctx.textBaseline = 'alphabetic'
  ctx.fillText('MANIFESTE', PAD + 34, 116)

  ctx.font = `800 72px ${FONT}`
  ctx.fillText(fit(ctx, spec.title, CARD_W - 2 * PAD), PAD, 200)
}

function subtitle(ctx: Ctx, spec: CardSpec) {
  ctx.fillStyle = C.muted
  ctx.font = `500 34px ${FONT}`
  const lines = wrap(ctx, spec.subtitle, CARD_W - 2 * PAD).slice(0, 2)
  lines.forEach((l, i) => ctx.fillText(l, PAD, 262 + i * 44))
}

function footer(ctx: Ctx, spec: CardSpec) {
  ctx.fillStyle = C.line
  ctx.fillRect(PAD, CARD_H - 96, CARD_W - 2 * PAD, 2)
  ctx.font = `700 30px ${FONT}`
  ctx.fillStyle = C.fg
  ctx.fillText('manifeste.pandeo.fr', PAD, CARD_H - 44)
  ctx.font = `400 26px ${FONT}`
  ctx.fillStyle = C.muted
  ctx.textAlign = 'right'
  ctx.fillText(spec.footerRight, CARD_W - PAD, CARD_H - 44)
  ctx.textAlign = 'left'
}

function drawNumbers(ctx: Ctx, body: Extract<CardBody, { kind: 'numbers' }>, top: number) {
  const n = body.stats.length
  const gap = 40
  const w = (CARD_W - 2 * PAD - gap * (n - 1)) / n
  const h = BOTTOM - top
  body.stats.forEach((s, i) => {
    const x = PAD + i * (w + gap)
    ctx.fillStyle = C.panel
    ctx.fillRect(x, top, w, h)
    ctx.fillStyle = TONE[s.tone]
    ctx.fillRect(x, top, 8, h)
    ctx.fillStyle = TONE[s.tone]
    ctx.font = `900 ${n > 2 ? 150 : 190}px ${FONT}`
    ctx.fillText(s.value, x + 48, top + h / 2 + 30, w - 72)
    ctx.fillStyle = C.muted
    ctx.font = `500 34px ${FONT}`
    wrap(ctx, s.label, w - 80)
      .slice(0, 2)
      .forEach((l, k) => ctx.fillText(l, x + 48, top + h / 2 + 100 + k * 42))
  })
}

function drawCurve(ctx: Ctx, body: Extract<CardBody, { kind: 'curve' }>, top: number) {
  const { points, highlight, peak } = body
  const left = PAD + 70
  const right = CARD_W - PAD - 20
  const t = top + 20
  const b = BOTTOM - 50
  if (points.length < 2) {
    ctx.fillStyle = C.muted
    ctx.font = `500 38px ${FONT}`
    ctx.fillText('Pas encore assez de jours pour tracer une courbe.', PAD, t + 120)
    return
  }
  const { step, max } = niceAxis(Math.max(...points.map((p) => p.value), 1))
  const x = (i: number) => left + (i / (points.length - 1)) * (right - left)
  const y = (v: number) => b - (v / max) * (b - t)

  // Grid and vertical labels.
  ctx.font = `400 24px ${FONT}`
  ctx.textAlign = 'right'
  for (let v = 0; v <= max; v += step) {
    ctx.fillStyle = C.line
    ctx.fillRect(left, y(v), right - left, 2)
    ctx.fillStyle = C.muted
    ctx.fillText(String(Math.round(v)), left - 14, y(v) + 8)
  }
  ctx.textAlign = 'left'

  // Area under the curve.
  const grad = ctx.createLinearGradient(0, t, 0, b)
  grad.addColorStop(0, 'rgba(255,69,58,0.45)')
  grad.addColorStop(1, 'rgba(255,69,58,0)')
  ctx.beginPath()
  ctx.moveTo(x(0), b)
  points.forEach((p, i) => ctx.lineTo(x(i), y(p.value)))
  ctx.lineTo(x(points.length - 1), b)
  ctx.closePath()
  ctx.fillStyle = grad
  ctx.fill()

  // The line.
  ctx.beginPath()
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(x(i), y(p.value)) : ctx.lineTo(x(i), y(p.value))))
  ctx.strokeStyle = C.red
  ctx.lineWidth = 6
  ctx.lineJoin = 'round'
  ctx.stroke()

  // Highlighted day and peak.
  const mark = (i: number, color: string, r: number) => {
    ctx.beginPath()
    ctx.arc(x(i), y(points[i]?.value ?? 0), r, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
  }
  const hi = highlight ? points.findIndex((p) => p.day === highlight) : points.length - 1
  if (hi >= 0) mark(hi, C.fg, 11)
  const pi = peak ? points.findIndex((p) => p.day === peak.day) : -1
  if (peak && pi >= 0) {
    mark(pi, C.orange, 11)
    ctx.fillStyle = C.fg
    ctx.font = `700 30px ${FONT}`
    const label = `${peak.value}`
    const w = ctx.measureText(label).width
    ctx.fillText(label, Math.min(Math.max(x(pi) - w / 2, left), right - w), y(peak.value) - 24)
  }

  // Dates under the axis: first, middle, last.
  ctx.fillStyle = C.muted
  ctx.font = `400 26px ${FONT}`
  const label = (i: number) => dayLabel(points[i]?.day ?? '')
  ctx.fillText(label(0), left, b + 44)
  const mid = Math.floor((points.length - 1) / 2)
  if (points.length > 4) {
    ctx.textAlign = 'center'
    ctx.fillText(label(mid), x(mid), b + 44)
  }
  ctx.textAlign = 'right'
  ctx.fillText(label(points.length - 1), right, b + 44)
  ctx.textAlign = 'left'
}

function drawRows(ctx: Ctx, body: Extract<CardBody, { kind: 'rows' }>, top: number) {
  const rows = body.rows
  if (rows.length === 0) return
  const max = Math.max(...rows.map((r) => r.value), 1)
  const rowH = Math.min(72, (BOTTOM - top) / rows.length)
  const labelW = 420
  const barX = PAD + labelW
  const barMax = CARD_W - PAD - barX - 150
  rows.forEach((r, i) => {
    const y = top + i * rowH
    ctx.fillStyle = C.fg
    ctx.font = `600 32px ${FONT}`
    ctx.fillText(fit(ctx, r.label, labelW - 20), PAD, y + rowH * 0.66)
    ctx.fillStyle = C.red
    ctx.fillRect(barX, y + rowH * 0.18, Math.max((r.value / max) * barMax, 6), rowH * 0.5)
    ctx.fillStyle = C.fg
    ctx.font = `700 32px ${FONT}`
    ctx.fillText(r.display, barX + Math.max((r.value / max) * barMax, 6) + 16, y + rowH * 0.66)
  })
}

function drawAppeal(ctx: Ctx, body: Extract<CardBody, { kind: 'appeal' }>, top: number) {
  ctx.fillStyle = C.panel
  ctx.fillRect(PAD, top + 10, CARD_W - 2 * PAD, BOTTOM - top - 20)
  ctx.fillStyle = C.red
  ctx.fillRect(PAD, top + 10, 8, BOTTOM - top - 20)
  ctx.fillStyle = C.fg
  ctx.font = `800 64px ${FONT}`
  ctx.fillText('manifeste.pandeo.fr', PAD + 56, top + (BOTTOM - top) / 2 + 10)
  ctx.fillStyle = C.muted
  ctx.font = `500 34px ${FONT}`
  ctx.fillText(body.line, PAD + 56, top + (BOTTOM - top) / 2 + 80)
}

/** Draws the picture. Exposed apart from the PNG step so it can be previewed. */
export function drawCard(canvas: HTMLCanvasElement, spec: CardSpec): void {
  canvas.width = CARD_W
  canvas.height = CARD_H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas indisponible')
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, CARD_W, CARD_H)
  ctx.textBaseline = 'alphabetic'
  header(ctx, spec)
  subtitle(ctx, spec)
  const long = ctx.measureText(spec.subtitle).width > CARD_W - 2 * PAD
  const top = long ? TOP + 90 : TOP + 50
  const body = spec.body
  if (body.kind === 'numbers') drawNumbers(ctx, body, top)
  else if (body.kind === 'curve') drawCurve(ctx, body, top)
  else if (body.kind === 'rows') drawRows(ctx, body, top)
  else drawAppeal(ctx, body, top)
  footer(ctx, spec)
}

export function cardPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Export PNG impossible'))),
      'image/png',
    ),
  )
}
