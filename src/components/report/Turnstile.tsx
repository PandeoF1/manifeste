import { useEffect, useRef } from 'react'

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  remove: (id: string) => void
  reset: (id: string) => void
}
declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let scriptPromise: Promise<void> | null = null
function loadScript(): Promise<void> {
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SCRIPT_SRC
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Turnstile indisponible'))
    document.head.appendChild(s)
  })
  return scriptPromise
}

export const turnstileEnabled = Boolean(SITE_KEY)

/**
 * Vérification anti-robot Cloudflare, chargée uniquement sur la page de signalement.
 * Désactivée si VITE_TURNSTILE_SITE_KEY n'est pas définie (développement).
 */
export function Turnstile({
  onToken,
  resetKey,
}: {
  onToken: (token: string | null) => void
  resetKey: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!SITE_KEY || !ref.current) return
    let id: string | null = null
    let cancelled = false
    void loadScript().then(() => {
      if (cancelled || !ref.current || !window.turnstile) return
      id = window.turnstile.render(ref.current, {
        sitekey: SITE_KEY,
        theme: 'dark',
        language: 'fr',
        callback: (t: string) => onToken(t),
        'expired-callback': () => onToken(null),
        'error-callback': () => onToken(null),
      })
    })
    return () => {
      cancelled = true
      if (id && window.turnstile) window.turnstile.remove(id)
    }
  }, [onToken, resetKey])
  if (!SITE_KEY) return null
  return <div ref={ref} className="min-h-16" />
}
