/**
 * Photo processing in the browser, before anything is sent:
 * - resizing (1600 px max);
 * - re-encoding through a canvas, which removes ALL metadata (GPS, device, date);
 * - irreversible blurring of the chosen areas (strong pixelation + blur).
 */

export const MAX_SIDE = 1600

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Loads an image honouring its EXIF orientation (without keeping the EXIF itself). */
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

/** Applies an irreversible blur on each area (coordinates in image pixels). */
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
    // 1. Very coarse pixelation (6 blocks max along the longest side).
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
    // 2. Blur on top to break the block edges.
    ctx.beginPath()
    ctx.rect(x, y, w, h)
    ctx.clip()
    ctx.filter = `blur(${Math.max(8, Math.round(Math.max(w, h) / 10))}px)`
    ctx.drawImage(out, x, y, w, h, x, y, w, h)
    ctx.restore()
  }
  return out
}

/** Encodes as JPEG (the canvas writes no metadata). */
export function toJpeg(canvas: HTMLCanvasElement, quality = 0.85): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Encodage impossible'))),
      'image/jpeg',
      quality,
    ),
  )
}
