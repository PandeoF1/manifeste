import { useEffect, useId, useRef, useState } from 'react'
import { ExternalLink, Phone, Scale, X } from 'lucide-react'
import { RIGHTS_INTRO, RIGHTS_LINKS, RIGHTS_SECTIONS } from '@/content/rights'

/**
 * Bouton « Tes droits » et sa fenêtre : gestes face aux forces de l'ordre, aux gaz et en garde à
 * vue. Le contenu est embarqué (disponible hors connexion) et rien n'est mesuré.
 */
export function RightsButton({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDialogElement>(null)
  const uid = useId()
  const titleId = `${uid}-title`
  const linksId = `${uid}-links`

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Tes droits"
        aria-haspopup="dialog"
        className={className}
      >
        <Scale size={20} aria-hidden="true" />
        <span className="sr-only md:not-sr-only">Tes droits</span>
      </button>
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          // Clic sur le fond : fermeture.
          if (e.target === ref.current) setOpen(false)
        }}
        className="m-auto max-h-[88dvh] w-[min(36rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-border bg-bg p-0 text-fg backdrop:bg-black/60"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-bg p-4">
          <div>
            <h2 id={titleId} className="text-lg font-black">
              Tes droits
            </h2>
            <p className="mt-1 text-sm text-muted">{RIGHTS_INTRO}</p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Fermer"
            className="icon-btn shrink-0"
          >
            <X size={22} aria-hidden="true" />
          </button>
        </div>
        <div className="space-y-3 p-4">
          {RIGHTS_SECTIONS.map((section, i) => (
            <details
              key={section.id}
              open={i === 0}
              className="rounded-xl border border-border bg-surface p-3"
            >
              <summary className="cursor-pointer font-bold">{section.title}</summary>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-sm">
                {section.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </details>
          ))}
          <section aria-labelledby={linksId} className="space-y-2 pt-1">
            <h3 id={linksId} className="text-sm font-bold">
              Numéros et liens utiles
            </h3>
            <ul className="space-y-2 text-sm">
              {RIGHTS_LINKS.map((l) => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    {...(l.href.startsWith('http')
                      ? { target: '_blank', rel: 'noopener noreferrer' }
                      : {})}
                    className="inline-flex items-center gap-1.5 underline"
                  >
                    {l.href.startsWith('http') ? (
                      <ExternalLink size={14} aria-hidden="true" />
                    ) : (
                      <Phone size={14} aria-hidden="true" />
                    )}
                    {l.label}
                  </a>
                  {l.phone && <span className="text-muted"> · {l.phone}</span>}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </dialog>
    </>
  )
}
