/**
 * Traitement des photos dans le navigateur, avant tout envoi :
 * - redimensionnement (1600 px max) ;
 * - réencodage via canvas, ce qui supprime TOUTES les métadonnées (GPS, appareil, date) ;
 * - floutage irréversible des zones choisies (pixellisation forte + flou).
 */

export const MAX_SIDE = 1600

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Charge une image en respectant l'orientation EXIF (sans conserver l'EXIF lui-même). */
export async function loadImage(file: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas indisponible')
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas
}

/** Applique un floutage irréversible sur chaque zone (coordonnées en pixels de l'image). */
export function redact(source: HTMLCanvasElement, rects: ReadonlyArray<Rect>): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = source.width
  out.height = source.height
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('Canvas indisponible')
  ctx.drawImage(source, 0, 0)

  for (const r of rects) {
    const x = Math.max(0, Math.floor(r.x))
    const y = Math.max(0, Math.floor(r.y))
    const w = Math.min(out.width - x, Math.ceil(r.w))
    const h = Math.min(out.height - y, Math.ceil(r.h))
    if (w < 2 || h < 2) continue
    // 1. Pixellisation très grossière (6 blocs max sur le plus grand côté).
    const blocks = 6
    const small = document.createElement('canvas')
    small.width = Math.max(1, Math.round((w / Math.max(w, h)) * blocks))
    small.height = Math.max(1, Math.round((h / Math.max(w, h)) * blocks))
    const sctx = small.getContext('2d')
    if (!sctx) continue
    sctx.drawImage(out, x, y, w, h, 0, 0, small.width, small.height)
    ctx.save()
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(small, 0, 0, small.width, small.height, x, y, w, h)
    // 2. Flou par-dessus pour casser les arêtes des blocs.
    ctx.beginPath()
    ctx.rect(x, y, w, h)
    ctx.clip()
    ctx.filter = `blur(${Math.max(8, Math.round(Math.max(w, h) / 10))}px)`
    ctx.drawImage(out, x, y, w, h, x, y, w, h)
    ctx.restore()
  }
  return out
}

/** Encode en JPEG (le canvas n'écrit aucune métadonnée). */
export function toJpeg(canvas: HTMLCanvasElement, quality = 0.85): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Encodage impossible'))),
      'image/jpeg',
      quality,
    ),
  )
}
