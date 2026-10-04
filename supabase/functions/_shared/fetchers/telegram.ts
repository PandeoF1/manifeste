import { parseHTML } from 'linkedom'
import { fetchText, type FetchLike, type ScrapedItem } from './types.ts'

/** Parse l'aperçu web public d'un canal (https://t.me/s/<canal>). */
export function parseTelegramChannel(html: string): ScrapedItem[] {
  const { document } = parseHTML(html)
  const items: ScrapedItem[] = []
  for (const node of document.querySelectorAll('.tgme_widget_message[data-post]')) {
    const post = node.getAttribute('data-post')
    if (!post || !/^[A-Za-z0-9_]+\/\d+$/.test(post)) continue
    const textNode = node.querySelector('.tgme_widget_message_text')
    if (!textNode) continue
    for (const br of textNode.querySelectorAll('br')) br.replaceWith('\n')
    const text = (textNode.textContent ?? '').trim()
    const datetime = node.querySelector('.tgme_widget_message_date time')?.getAttribute('datetime')
    const publishedAt = datetime ? new Date(datetime) : null
    if (!text || !publishedAt || Number.isNaN(publishedAt.getTime())) continue
    items.push({ externalId: post, url: `https://t.me/${post}`, text, publishedAt })
  }
  return items
}

export async function fetchTelegram(fetchFn: FetchLike, channel: string): Promise<ScrapedItem[]> {
  const html = await fetchText(fetchFn, `https://t.me/s/${encodeURIComponent(channel)}`)
  return parseTelegramChannel(html)
}
