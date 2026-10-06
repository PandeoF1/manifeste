// Robots servis par /api/share : aperçus de partage et moteurs de recherche.
// Même liste que les réécritures de vercel.json (à garder synchronisées).
export const BOT_UA =
  /discordbot|telegrambot|whatsapp|facebookexternalhit|facebot|twitterbot|slackbot|linkedinbot|skypeuripreview|redditbot|mastodon|bluesky|cardyb|iframely|embedly|pinterest|vkshare|snapchat|applebot|signal|googlebot|google-inspectiontool|storebot-google|bingbot|msnbot|duckduckbot|qwant|yandex|baiduspider|ecosia|petalbot|seznambot|yahoo! slurp/i

export const isBot = (userAgent: string | null) => BOT_UA.test(userAgent ?? '')
