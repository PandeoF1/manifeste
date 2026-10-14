/**
 * Robust decoding of pages and feeds: many press sites announce an encoding (HTTP header or
 * <meta charset>) that does not match the real content, which yields "LunÃ©ville" instead of
 * "Lunéville".
 */

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
 * Decodes bytes: strict UTF-8 first (by far the most common case, even when the site announces
 * something else), then the declared encoding, then Windows-1252.
 */
export function decodeBody(bytes: Uint8Array, contentType: string | null): string {
  try {
    return repairMojibake(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    // not valid UTF-8
  }
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 4096))
  const charset = declaredCharset(contentType, head)
  const candidates = [charset, 'windows-1252'].filter(
    (c): c is string => Boolean(c) && c !== 'utf-8' && c !== 'utf8',
  )
  for (const label of candidates) {
    try {
      return new TextDecoder(label as ConstructorParameters<typeof TextDecoder>[0]).decode(bytes)
    } catch {
      // unknown encoding
    }
  }
  return new TextDecoder('utf-8').decode(bytes)
}

/**
 * Repairs UTF-8 text that was decoded as Latin-1 / Windows-1252 ("Ã©" -> "é"). Leaves the text
 * alone when it shows no such defect, or when the repair would not improve it.
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
    if (b === undefined) return text // a character outside Latin-1: not a plain double decoding
    bytes.push(b)
  }
  try {
    const repaired = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes))
    return SUSPICIOUS.test(repaired) ? text : repaired
  } catch {
    return text
  }
}

/**
 * The body of a response, read as a stream and abandoned once `maxBytes` have arrived (plus the
 * chunk that crossed the line). `arrayBuffer()` would load a whole multi-gigabyte answer in memory
 * before any limit could apply; this stops at the limit and cancels the download.
 */
export async function readBytes(res: Response, maxBytes: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(await res.arrayBuffer())
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (total <= maxBytes) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      total += value.length
    }
  } finally {
    // Stops the transfer when we leave early; harmless after the end of the body.
    await reader.cancel().catch(() => {})
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

/**
 * Reads an HTTP response body with the robust decoding. At most about `maxBytes` are downloaded;
 * the rest of the answer is never read.
 */
export async function readText(res: Response, maxBytes = 2_000_000): Promise<string> {
  const buf = await readBytes(res, maxBytes)
  const contentType = res.headers.get('content-type')
  if (buf.length <= maxBytes) return decodeBody(buf, contentType)
  // Cut on a character boundary: a truncated UTF-8 character would make the whole page
  // "invalid" and switch the decoding to Windows-1252.
  let end = maxBytes
  while (end > 0 && ((buf[end] ?? 0) & 0xc0) === 0x80) end--
  return decodeBody(buf.slice(0, end), contentType)
}
