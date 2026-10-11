/**
 * Is this page the article, or something standing in its place? Bot walls and consent pages are
 * served with a 200 status and a few hundred characters of text, so the collector would feed
 * them to the AI as if they were articles. A paywall is different: the article is there but cut
 * short, which the judge should know.
 */
import type { ArticleLd } from './json-ld.ts'
import type { Blocked } from './types.ts'

/** Below this, a page may be a stand-in; above it, it is an article whatever it says about cookies. */
const STAND_IN_MAX_CHARS = 600

const TITLE_WALLS: Array<[RegExp, Blocked['reason']]> = [
  [
    /\b(just a moment|un instant|attention required|checking your browser|vérification de sécurité|security check|ddos protection)\b/i,
    'bot-wall',
  ],
  [
    /\b(are you a (human|robot)|verify you are (a )?human|êtes-vous un robot|captcha|vérifiez que vous êtes)\b/i,
    'captcha',
  ],
  [
    /\b(access denied|accès refusé|acces refuse|403 forbidden|forbidden|request blocked|you have been blocked|too many requests|accès (bloqué|interdit))\b/i,
    'access-denied',
  ],
  [
    /\b(404|page (introuvable|non trouvée|not found)|not found|cette page n['’]existe pas)\b/i,
    'not-found',
  ],
]

/** Scripts and hosts that only appear on challenge pages (or next to the article of a protected site). */
const WALL_MARKERS = [
  'cf-chl',
  '_cf_chl_opt',
  'challenge-platform',
  'captcha-delivery.com',
  'datadome',
  'px-captcha',
  'perimeterx',
  'incapsula',
  'akamai-bot',
  'hcaptcha.com',
  'g-recaptcha',
]

const CONSENT_MARKERS = [
  'didomi',
  'onetrust',
  'sourcepoint',
  'cookiebot',
  'consent-wall',
  'cmp-wall',
]

const PAYWALL_TEXT =
  /\b(réservé aux abonnés|article réservé|contenu réservé|pour lire la suite|la suite de cet article est réservée|lire la suite avec|débloquez cet article|offre (numérique|abonnement))\b/i

export interface BlockedInput {
  title: string
  /** Characters of article text extracted. */
  chars: number
  /** The raw HTML (only its first part is read). */
  html: string
  /** The page's visible text, for markers (a sample is enough). */
  visible: string
  ld: ArticleLd | null
}

export function detectBlocked(input: BlockedInput): Blocked | null {
  const head = input.html.slice(0, 300_000).toLowerCase()
  const standIn = input.chars < STAND_IN_MAX_CHARS

  if (standIn) {
    for (const [pattern, reason] of TITLE_WALLS) {
      const hit =
        pattern.exec(input.title) ??
        (input.chars < 200 ? pattern.exec(input.visible.slice(0, 400)) : null)
      if (hit) return { reason, evidence: `title or text: "${hit[0]}"` }
    }
    const wall = WALL_MARKERS.find((m) => head.includes(m))
    if (wall && input.chars < 300) return { reason: 'bot-wall', evidence: `marker: ${wall}` }
    const consent = CONSENT_MARKERS.find((m) => head.includes(m))
    if (
      consent &&
      input.chars < 300 &&
      /cookies?|consentement|cookie/i.test(input.visible.slice(0, 600))
    )
      return { reason: 'consent-wall', evidence: `marker: ${consent}` }
  }

  if (input.ld?.isAccessibleForFree === false)
    return { reason: 'paywall', evidence: 'json-ld isAccessibleForFree=false' }
  const paywall = PAYWALL_TEXT.exec(input.visible)
  if (paywall && input.chars < 4000) return { reason: 'paywall', evidence: `text: "${paywall[0]}"` }

  if (input.chars < 120) return { reason: 'empty', evidence: `${input.chars} characters of text` }
  return null
}
