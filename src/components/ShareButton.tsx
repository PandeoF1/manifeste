import { useState } from 'react'
import { Check, Share2 } from 'lucide-react'

/** Partage natif (téléphone) ou copie du lien (ordinateur). */
export function ShareButton({
  url,
  title,
  text,
  className = 'btn-secondary',
  label = 'Partager',
}: {
  url: string
  title: string
  text?: string
  className?: string
  label?: string
}) {
  const [copied, setCopied] = useState(false)
  async function share() {
    const absolute = new URL(url, window.location.origin).toString()
    if (navigator.share) {
      try {
        await navigator.share({ url: absolute, title, text })
        return
      } catch {
        // partage annulé : on ne fait rien
        return
      }
    }
    try {
      await navigator.clipboard.writeText(absolute)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Copie ce lien :', absolute)
    }
  }
  return (
    <button type="button" onClick={() => void share()} className={className}>
      {copied ? <Check size={18} aria-hidden="true" /> : <Share2 size={18} aria-hidden="true" />}
      <span aria-live="polite">{copied ? 'Lien copié' : label}</span>
    </button>
  )
}
