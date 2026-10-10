import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ACTIVE_PHRASE } from '@shared/status.ts'
import { joursQuery, resumeQuery } from '@/queries/donnees'
import { DailyBars } from '@/components/donnees/DailyBars'
import { fmtInt } from '@/lib/donneesFormat'

export const Route = createFileRoute('/embed/chiffres')({
  component: EmbedChiffres,
})

/** Chiffres à intégrer sur un autre site (iframe) : compteur en direct et courbe jour par jour. */
function EmbedChiffres() {
  const resume = useQuery(resumeQuery)
  const jours = useQuery(joursQuery)
  const r = resume.data
  const maintenant = r ? r.en_ce_moment.bloques + r.en_ce_moment.filtrants : null
  return (
    <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <header>
        <p className="text-4xl leading-none font-black tabular-nums">
          {maintenant != null ? fmtInt(maintenant) : '…'}
        </p>
        <p className="mt-1">établissements {ACTIVE_PHRASE} en ce moment</p>
        {r && (
          <p className="text-sm text-muted">
            {fmtInt(r.etablissements)} signalés depuis le début, dans {fmtInt(r.departements)}{' '}
            départements.
          </p>
        )}
      </header>
      {jours.data && <DailyBars jours={jours.data} compact />}
      <footer className="mt-auto pt-2 text-xs text-muted">
        Source :{' '}
        <a
          href="/donnees"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
        >
          Manifeste
        </a>
        , données libres (CC BY 4.0).
      </footer>
    </main>
  )
}
