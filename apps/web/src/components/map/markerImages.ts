import type { Map as MapLibreMap } from 'maplibre-gl'
import type { ReportStatus } from '@shared/status.ts'
import { MAP_STATUS_COLORS } from './palette'

const SIZE = 28

/**
 * A distinct shape per status (never colour alone):
 * blocked = crossed octagon, filtering = "!" triangle, lifted = ticked circle.
 */
function draw(status: ReportStatus, ratio: number): ImageData {
  const px = SIZE * ratio
  const canvas = document.createElement('canvas')
  canvas.width = px
  canvas.height = px
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D indisponible')
  ctx.scale(ratio, ratio)
  ctx.lineWidth = 2
  ctx.strokeStyle = '#05070b'
  ctx.fillStyle = MAP_STATUS_COLORS[status]

  const s = SIZE
  ctx.beginPath()
  if (status === 'bloque') {
    const a = s * 0.29
    const b = s - a
    ctx.moveTo(a, 2)
    ctx.lineTo(b, 2)
    ctx.lineTo(s - 2, a)
    ctx.lineTo(s - 2, b)
    ctx.lineTo(b, s - 2)
    ctx.lineTo(a, s - 2)
    ctx.lineTo(2, b)
    ctx.lineTo(2, a)
  } else if (status === 'filtrant') {
    ctx.moveTo(s / 2, 2)
    ctx.lineTo(s - 1.5, s - 3)
    ctx.lineTo(1.5, s - 3)
  } else {
    ctx.arc(s / 2, s / 2, s / 2 - 2, 0, Math.PI * 2)
  }
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  ctx.fillStyle = '#ffffff'
  ctx.strokeStyle = '#ffffff'
  if (status === 'bloque') {
    ctx.fillRect(s * 0.25, s * 0.44, s * 0.5, s * 0.12)
  } else if (status === 'filtrant') {
    ctx.fillStyle = '#05070b'
    ctx.fillRect(s / 2 - 1.5, s * 0.34, 3, s * 0.3)
    ctx.fillRect(s / 2 - 1.5, s * 0.7, 3, 3)
  } else {
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.moveTo(s * 0.3, s * 0.52)
    ctx.lineTo(s * 0.44, s * 0.66)
    ctx.lineTo(s * 0.71, s * 0.37)
    ctx.stroke()
  }
  return ctx.getImageData(0, 0, px, px)
}

export function addMarkerImages(map: MapLibreMap) {
  const ratio = Math.min(3, Math.max(1, Math.round(window.devicePixelRatio || 1)))
  for (const status of ['bloque', 'filtrant', 'leve'] as const) {
    const id = `status-${status}`
    if (map.hasImage(id)) map.removeImage(id)
    map.addImage(id, draw(status, ratio), { pixelRatio: ratio })
  }
}
