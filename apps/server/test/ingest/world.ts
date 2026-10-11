/** A tiny world for pipeline tests: a feed, article pages and a model that reads the prompt. */
import { DEFAULT_AI_CONFIG, type AiConfig } from '@manifeste/ai'

/** A Wednesday: lycées are open. */
export const NOW = new Date('2026-10-07T10:00:00Z')
export const rss = (items: Array<{ guid: string; title: string; link: string; pub?: string }>) =>
  `<?xml version="1.0"?><rss version="2.0"><channel>${items
    .map(
      (i) =>
        `<item><guid>${i.guid}</guid><title>${i.title}</title><link>${i.link}</link><pubDate>${i.pub ?? 'Wed, 07 Oct 2026 08:30:00 GMT'}</pubDate></item>`,
    )
    .join('')}</channel></rss>`
export const paragraphs = (school: string) =>
  Array.from(
    { length: 5 },
    (_, i) =>
      `<p>Les élèves du ${school} ont bloqué l'entrée ce matin, paragraphe ${i + 1}, pour protester contre la réforme.</p>`,
  ).join('')
export const page = (title: string, school: string) =>
  `<html lang="fr"><head><title>${title}</title></head><body><article>${paragraphs(school)}</article></body></html>`

export interface World {
  feed: string
  pages: Record<string, string>
  /** What the model says for a text containing the key. */
  facts: Array<{ when: string; events: object[] }>
  down: boolean
  geminiCalls: number
  geminiDown: boolean
}
export const world: World = {
  feed: '',
  pages: {},
  facts: [],
  down: false,
  geminiCalls: 0,
  geminiDown: false,
}

export const fetchFn = async (url: string): Promise<Response> => {
  if (url === 'https://press.example/feed')
    return world.down ? new Response('', { status: 500 }) : new Response(world.feed)
  const html = world.pages[url]
  return html ? new Response(html) : new Response('', { status: 404 })
}

/** A Gemini that answers from `world.facts`, by looking at the items of the prompt. */
export const geminiFetch = async (
  _url: string | URL | Request,
  init?: RequestInit,
): Promise<Response> => {
  world.geminiCalls++
  if (world.geminiDown)
    return new Response(JSON.stringify({ error: { message: 'overloaded' } }), { status: 503 })
  const body = JSON.parse(String(init?.body)) as {
    contents: Array<{ parts: Array<{ text: string }> }>
  }
  const prompt = body.contents[0]?.parts[0]?.text ?? ''
  const items = JSON.parse(prompt.slice(prompt.indexOf('['))) as Array<{
    id: string
    texte: string
  }>
  const events = items.flatMap((item) =>
    world.facts
      .filter((f) => item.texte.includes(f.when))
      .flatMap((f) => f.events.map((e) => ({ item_id: item.id, ...e }))),
  )
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ events }) }] } }],
      usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100 },
    }),
  )
}

export const event = (over: Record<string, unknown> = {}) => ({
  school_name: 'Lycée Pasteur',
  city: 'Lille',
  status: 'bloque',
  observed_at: null,
  certainty: 'haute',
  ...over,
})

export const aiConfig = (over: Partial<AiConfig> = {}): AiConfig => ({
  ...DEFAULT_AI_CONFIG,
  credentials: { gemini: { apiKey: 'k' }, openaiCompatible: {} },
  tasks: {
    ...DEFAULT_AI_CONFIG.tasks,
    extract: {
      ...DEFAULT_AI_CONFIG.tasks.extract,
      models: [{ provider: 'gemini', model: 'gemini-3.5-flash-lite' }],
      retriesPerModel: 0,
    },
    judge: { kind: 'off' },
  },
  ...over,
})
