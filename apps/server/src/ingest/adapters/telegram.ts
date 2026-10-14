import { $, $$, attr, linesOf, loadDocument } from '@manifeste/parser/html'
import { fetchText } from '../http.ts'
import { IdentifierError, type ScrapedItem, type SourceAdapter } from '../types.ts'

/** Parses the public web preview of a channel (https://t.me/s/<channel>). */
export function parseTelegramChannel(html: string): ScrapedItem[] {
  const doc = loadDocument(html)
  const items: ScrapedItem[] = []
  for (const message of $$('.tgme_widget_message', doc)) {
    const post = attr(message, 'data-post')
    if (!/^[A-Za-z0-9_]+\/\d+$/.test(post)) continue
    const body = $('.tgme_widget_message_text', message)
    if (!body) continue
    const text = linesOf(body)
    const time = $('time', $('.tgme_widget_message_date', message) ?? message)
    const datetime = time ? attr(time, 'datetime') : ''
    const publishedAt = datetime ? new Date(datetime) : null
    if (!text || !publishedAt || Number.isNaN(publishedAt.getTime())) continue
    items.push({ externalId: post, url: `https://t.me/${post}`, text, publishedAt })
  }
  return items
}

export const telegramAdapter: SourceAdapter = {
  kind: 'telegram',
  label: 'Public Telegram channel',
  normalize(input) {
    const raw = input.trim()
    // "@channel", "channel", "https://t.me/channel", "https://t.me/s/channel"
    const m = raw.match(
      /^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/(?:s\/)?([A-Za-z0-9_]+)\/?$/,
    )
    const name = m?.[1] ?? raw.replace(/^@/, '')
    if (!/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(name))
      throw new IdentifierError('Invalid Telegram channel name (5 to 32 letters, digits or _).')
    return name.toLowerCase()
  },
  async discover(fetchFn, identifier) {
    return parseTelegramChannel(
      await fetchText(fetchFn, `https://t.me/s/${encodeURIComponent(identifier)}`),
    )
  },
}
