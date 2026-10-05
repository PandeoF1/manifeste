// Décodage robuste des pages et flux : beaucoup de sites de presse annoncent un encodage
// (en-tête HTTP ou <meta charset>) qui ne correspond pas au contenu réel, ce qui produit
// « LunÃ©ville » au lieu de « Lunéville ».

const SUSPICIOUS = /[ÃÂ][\u0080-¿]|â€[\u0080-¿™œž]/

function declaredCharset(contentType: string | null, head: string): string | null {
  const fromHeader = contentType?.match(/charset=["']?([\w-]+)/i)?.[1]
  const fromMeta =
    head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ??
    head.match(/<\?xml[^>]+encoding=["']([\w-]+)["']/i)?.[1]
  const charset = (fromMeta ?? fromHeader ?? '').toLowerCase()
  return charset || null
}

/**
 * Décode des octets : UTF-8 strict d'abord (le cas de loin le plus fréquent, même quand le site
 * annonce autre chose), sinon l'encodage déclaré, sinon Windows-1252.
 */
export function decodeBody(bytes: Uint8Array, contentType: string | null): string {
  try {
    return repairMojibake(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    // pas de l'UTF-8 valide
  }
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 4096))
  const charset = declaredCharset(contentType, head)
  const candidates = [charset, 'windows-1252'].filter(
    (c): c is string => Boolean(c) && c !== 'utf-8' && c !== 'utf8',
  )
  for (const label of candidates) {
    try {
      return new TextDecoder(label).decode(bytes)
    } catch {
      // encodage inconnu
    }
  }
  return new TextDecoder('utf-8').decode(bytes)
}

/**
 * Répare un texte UTF-8 qui a été décodé comme du Latin-1 / Windows-1252 (« Ã© » -> « é »).
 * Ne touche à rien si le texte ne présente pas ce défaut, ou si la réparation n'améliore rien.
 */
export function repairMojibake(text: string): string {
  if (!SUSPICIOUS.test(text)) return text
  const cp1252: Record<number, number> = {
    0x20ac: 0x80,
    0x201a: 0x82,
    0x0192: 0x83,
    0x201e: 0x84,
    0x2026: 0x85,
    0x2020: 0x86,
    0x2021: 0x87,
    0x02c6: 0x88,
    0x2030: 0x89,
    0x0160: 0x8a,
    0x2039: 0x8b,
    0x0152: 0x8c,
    0x017d: 0x8e,
    0x2018: 0x91,
    0x2019: 0x92,
    0x201c: 0x93,
    0x201d: 0x94,
    0x2022: 0x95,
    0x2013: 0x96,
    0x2014: 0x97,
    0x02dc: 0x98,
    0x2122: 0x99,
    0x0161: 0x9a,
    0x203a: 0x9b,
    0x0153: 0x9c,
    0x017e: 0x9e,
    0x0178: 0x9f,
  }
  const bytes: number[] = []
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    const b = code <= 0xff ? code : cp1252[code]
    if (b === undefined) return text // caractère hors Latin-1 : pas un simple double décodage
    bytes.push(b)
  }
  try {
    const repaired = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes))
    return SUSPICIOUS.test(repaired) ? text : repaired
  } catch {
    return text
  }
}

/** Lit le corps d'une réponse HTTP avec le décodage robuste. */
export async function readText(res: Response, maxBytes = 2_000_000): Promise<string> {
  const buf = new Uint8Array(await res.arrayBuffer())
  const contentType = res.headers.get('content-type')
  if (buf.length <= maxBytes) return decodeBody(buf, contentType)
  // Coupe sur une frontière de caractère : un caractère UTF-8 tronqué rendrait toute la page
  // « invalide » et ferait basculer le décodage sur Windows-1252.
  let end = maxBytes
  while (end > 0 && ((buf[end] ?? 0) & 0xc0) === 0x80) end--
  return decodeBody(buf.slice(0, end), contentType)
}
