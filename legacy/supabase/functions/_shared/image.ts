/** Contrôles binaires des photos envoyées (sans dépendance : Deno et navigateur). */

export type ImageKind = 'jpeg' | 'webp'

export function detectImageKind(bytes: Uint8Array): ImageKind | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'jpeg'
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return 'webp'
  }
  return null
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let s = ''
  for (let i = start; i < start + length && i < bytes.length; i++)
    s += String.fromCharCode(bytes[i] ?? 0)
  return s
}

/**
 * Vrai si l'image contient des métadonnées identifiantes (EXIF/GPS, XMP, IPTC).
 * Les photos réencodées par le formulaire (canvas) n'en ont jamais : toute présence est refusée.
 */
export function hasMetadata(bytes: Uint8Array): boolean {
  const kind = detectImageKind(bytes)
  if (kind === 'jpeg') {
    let i = 2
    while (i + 4 <= bytes.length) {
      if (bytes[i] !== 0xff) return false
      const marker = bytes[i + 1] ?? 0
      // Début des données d'image : plus aucun segment de métadonnées après.
      if (marker === 0xda || marker === 0xd9) return false
      const length = ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0)
      // APP1 (EXIF, XMP), APP13 (IPTC/Photoshop), COM (commentaire).
      if (marker === 0xe1 || marker === 0xed || marker === 0xfe) return true
      if (length < 2) return false
      i += 2 + length
    }
    return false
  }
  if (kind === 'webp') {
    // Chunks RIFF : EXIF et XMP interdits.
    let i = 12
    while (i + 8 <= bytes.length) {
      const id = ascii(bytes, i, 4)
      if (id === 'EXIF' || id === 'XMP ') return true
      const size =
        (bytes[i + 4] ?? 0) |
        ((bytes[i + 5] ?? 0) << 8) |
        ((bytes[i + 6] ?? 0) << 16) |
        ((bytes[i + 7] ?? 0) << 24)
      if (size < 0) return false
      i += 8 + size + (size % 2)
    }
    return false
  }
  return false
}
