import { useState } from 'react'
import type { ErrorComponentProps } from '@tanstack/react-router'
import { resetLocalData } from '@/lib/resetLocal'

/**
 * What a visitor sees when a page crashes. The discreet link at the bottom clears everything the
 * browser stored for the site (a stale cache or service worker is the usual cause of a crash
 * that survives a reload) and starts over.
 */
export function CrashScreen({ error, reset }: ErrorComponentProps) {
  const [clearing, setClearing] = useState(false)
  const [details, setDetails] = useState(false)

  async function clearAndRestart() {
    setClearing(true)
    await resetLocalData()
    window.location.replace('/')
  }

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-bold">Une erreur est survenue</h1>
      <p className="text-sm text-muted">
        La page n'a pas pu s'afficher. Recharger suffit le plus souvent.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary min-h-11 px-4"
          onClick={() => window.location.reload()}
        >
          Recharger
        </button>
        <button type="button" className="btn-secondary min-h-11 px-4" onClick={() => reset()}>
          Réessayer
        </button>
      </div>
      <div className="mt-6 flex flex-col items-start gap-2 text-xs text-muted">
        <button
          type="button"
          className="underline underline-offset-2 opacity-70 hover:opacity-100"
          disabled={clearing}
          onClick={() => void clearAndRestart()}
        >
          {clearing
            ? 'Nettoyage…'
            : "Ça recommence ? Vider les données de l'appli et repartir de zéro"}
        </button>
        <button
          type="button"
          className="underline underline-offset-2 opacity-70 hover:opacity-100"
          onClick={() => setDetails((d) => !d)}
          aria-expanded={details}
        >
          {details ? 'Masquer le détail' : "Détail de l'erreur"}
        </button>
        {details && (
          <pre className="max-w-full overflow-auto rounded-md border border-border bg-surface p-2 text-[11px]">
            {error instanceof Error ? `${error.name}: ${error.message}` : String(error)}
          </pre>
        )}
      </div>
    </main>
  )
}
