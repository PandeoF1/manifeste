import { describe, expect, it } from 'bun:test'
import { decodeBody, readBytes, readText, repairMojibake } from '../src/encoding.ts'

const utf8 = (s: string) => new TextEncoder().encode(s)
const latin1 = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)))

describe('page and feed encoding', () => {
  it('correct UTF-8, even when the site announces ISO-8859-1', () => {
    expect(
      decodeBody(utf8('Lycée Ernest-Bichat, Lunéville'), 'text/html; charset=iso-8859-1'),
    ).toBe('Lycée Ernest-Bichat, Lunéville')
  })

  it('page really in Latin-1 (meta charset)', () => {
    const html = '<meta charset="iso-8859-1"><title>Lunéville : le lycée bloqué</title>'
    expect(decodeBody(latin1(html), 'text/html')).toContain('Lunéville : le lycée bloqué')
  })

  it('Latin-1 page with no declaration: Windows-1252', () => {
    expect(decodeBody(latin1('Lunéville'), null)).toBe('Lunéville')
  })

  it('repairs a double decoding', () => {
    expect(repairMojibake('LunÃ©ville')).toBe('Lunéville')
    expect(repairMojibake('LycÃ©e Ã‰mile-Zola, lâ€™entrÃ©e bloquÃ©e')).toBe(
      'Lycée Émile-Zola, l’entrée bloquée',
    )
  })

  it('leaves correct text alone', () => {
    for (const s of ['Lunéville', 'Ã la une', 'Prix : 5 €', 'Saint-Étienne']) {
      expect(repairMojibake(s)).toBe(s)
    }
  })

  it('truncates without breaking an accented character', async () => {
    const body = utf8('éééé') // 8 octets
    expect(await readText(new Response(body), 3)).toBe('é')
  })

  it('reads an HTTP response', async () => {
    const res = new Response(latin1('<?xml version="1.0" encoding="ISO-8859-1"?><t>Besançon</t>'), {
      headers: { 'content-type': 'application/xml' },
    })
    expect(await readText(res)).toContain('Besançon')
  })
})

describe('reading a body with a hard limit', () => {
  /** A body that never ends, and counts what was pulled from it. */
  const endless = () => {
    const state = { pulled: 0, cancelled: false }
    const chunk = new TextEncoder().encode('x'.repeat(10_000))
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        state.pulled += chunk.length
        controller.enqueue(chunk)
      },
      cancel() {
        state.cancelled = true
      },
    })
    return { state, response: new Response(body) }
  }

  it('stops downloading at the limit instead of loading the whole answer', async () => {
    const { state, response } = endless()
    const text = await readText(response, 50_000)
    expect(text.length).toBe(50_000)
    expect(state.cancelled).toBe(true)
    // The limit plus a few chunks of look-ahead, never the "infinite" rest.
    expect(state.pulled).toBeLessThan(200_000)
  })

  it('returns a short body whole', async () => {
    const bytes = await readBytes(new Response('bonjour'), 1000)
    expect(new TextDecoder().decode(bytes)).toBe('bonjour')
  })
})
