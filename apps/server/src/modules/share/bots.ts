/**
 * Robots served the server-rendered page: share previews (Discord, Telegram, WhatsApp, X…) and
 * search engines. Humans always get the SPA.
 */
export const BOT_UA =
  /discordbot|telegrambot|whatsapp|facebookexternalhit|facebot|twitterbot|slackbot|linkedinbot|skypeuripreview|redditbot|mastodon|bluesky|cardyb|iframely|embedly|pinterest|vkshare|snapchat|applebot|signal|googlebot|google-inspectiontool|storebot-google|bingbot|msnbot|duckduckbot|qwant|yandex|baiduspider|ecosia|petalbot|seznambot|yahoo! slurp/i

export const isShareBot = (userAgent: string | null | undefined): boolean =>
  BOT_UA.test(userAgent ?? '')
