import { describe, expect, it } from 'vitest'
import { detectImageKind, hasMetadata } from '@shared/image.ts'
import { roundCoord, submissionFieldsSchema } from '@shared/submission.ts'

const jpeg = (...segments: number[][]) =>
  new Uint8Array([0xff, 0xd8, ...segments.flat(), 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9])
const seg = (marker: number, payload: number[]) => [
  0xff,
  marker,
  0x00,
  payload.length + 2,
  ...payload,
]

describe('photos', () => {
  it('détecte JPEG et WebP', () => {
    expect(detectImageKind(jpeg())).toBe('jpeg')
    const webp = new TextEncoder().encode('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ')
    expect(detectImageKind(webp)).toBe('webp')
    expect(detectImageKind(new TextEncoder().encode('GIF89a'))).toBeNull()
  })

  it('accepte un JPEG sans métadonnées (APP0/JFIF seul)', () => {
    expect(hasMetadata(jpeg(seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0])))).toBe(false)
  })

  it('refuse EXIF, IPTC et commentaires', () => {
    expect(hasMetadata(jpeg(seg(0xe0, [0]), seg(0xe1, [0x45, 0x78, 0x69, 0x66])))).toBe(true)
    expect(hasMetadata(jpeg(seg(0xed, [1, 2])))).toBe(true)
    expect(hasMetadata(jpeg(seg(0xfe, [1])))).toBe(true)
  })

  it('refuse un WebP avec chunk EXIF', () => {
    const enc = new TextEncoder()
    const chunk = (id: string, size: number) => [
      ...enc.encode(id),
      size,
      0,
      0,
      0,
      ...new Array(size).fill(0),
    ]
    const webp = (chunks: number[][]) =>
      new Uint8Array([...enc.encode('RIFF'), 0, 0, 0, 0, ...enc.encode('WEBP'), ...chunks.flat()])
    expect(hasMetadata(webp([chunk('VP8X', 10), chunk('VP8 ', 4)]))).toBe(false)
    expect(hasMetadata(webp([chunk('VP8X', 10), chunk('EXIF', 6)]))).toBe(true)
  })
})

describe('formulaire de signalement', () => {
  const base = { school_uai: '0750654D', status: 'bloque', lat: '48.8461', lng: '2.3447' }

  it('accepte un signalement sans lien', () => {
    const r = submissionFieldsSchema.safeParse(base)
    expect(r.success && r.data.source_url).toBeUndefined()
  })
  it('refuse un lien non https et un statut inconnu', () => {
    expect(submissionFieldsSchema.safeParse({ ...base, source_url: 'http://x.fr' }).success).toBe(
      false,
    )
    expect(submissionFieldsSchema.safeParse({ ...base, status: 'grève' }).success).toBe(false)
    expect(submissionFieldsSchema.safeParse({ ...base, lat: '200' }).success).toBe(false)
    expect(submissionFieldsSchema.safeParse({ ...base, lat: 'abc' }).success).toBe(false)
  })
  it('arrondit la position à ~100 m', () => {
    expect(roundCoord(48.846123)).toBe(48.846)
    expect(roundCoord(2.34477)).toBe(2.345)
  })
})
