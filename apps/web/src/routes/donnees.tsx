import { useEffect, type ReactNode } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ACTIVE_PHRASE, blockedPhrase } from '@/lib/labels'
import { CONTACT_EMAIL } from '@/config/legal'
import { departmentName } from '@/config/departments'
import {
  academiesQuery,
  departementsQuery,
  joursQuery,
  resumeQuery,
  type Origine,
  type Resume,
} from '@/queries/donnees'
import { fmtDateTime, fmtDay, fmtInt, pct } from '@/lib/donneesFormat'
import { DailyBars } from '@/components/donnees/DailyBars'
import { ZoneTable } from '@/components/donnees/ZoneTable'
import { EmbedSection, ExportSection } from '@/components/donnees/ExportSection'

export const Route = createFileRoute('/donnees')({
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(resumeQuery)
    void context.queryClient.prefetchQuery(joursQuery)
  },
  component: DataPage,
})

const TITLE = 'Les chiffres du mouvement lycéen et étudiant - données libres - Manifeste'

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="text-xl font-black">
        {title}
      </h2>
      <div className="space-y-3 leading-relaxed">{children}</div>
    </section>
  )
}

function Figure({ value, children }: { value: string; children: ReactNode }) {
  return (
    <div>
      <dd className="text-3xl leading-none font-black tabular-nums">{value}</dd>
      <dt className="mt-1 text-sm text-muted">{children}</dt>
    </div>
  )
}

const ORIGINE: Record<Origine, { nom: string; valeur: string }> = {
  presse: {
    nom: 'Presse',
    valeur:
      'Un article de presse, avec son lien. Le média est connu et la source peut être relue par n’importe qui.',
  },
  syndicat: {
    nom: 'Organisations et syndicats',
    valeur:
      'Un communiqué ou un compte public, avec son lien. Une source engagée, à lire comme telle.',
  },
  collecteur: {
    nom: 'Autres sources collectées',
    valeur:
      'Réseaux, agrégateurs, canaux publics. Avec lien, mais recoupés ou validés à la main avant publication.',
  },
  utilisateur: {
    nom: 'Signalements sur place',
    valeur:
      'Envoyés par une personne présente, validés à la main. Pas de tiers pour les confirmer, c’est pourquoi on les compte à part. Ni photo ni position ne sont publiées.',
  },
}

function DataPage() {
  useEffect(() => {
    const previous = document.title
    document.title = TITLE
    return () => {
      document.title = previous
    }
  }, [])
  const resume = useQuery(resumeQuery)
  const jours = useQuery(joursQuery)
  const departements = useQuery(departementsQuery)
  const academies = useQuery(academiesQuery)
  const r = resume.data
  const presse = r?.origines.find((o) => o.origine === 'presse')
  const partPresse =
    r && presse ? ` (${pct(presse.signalements, r.signalements)} des signalements)` : ''

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-12 overflow-y-auto p-4 pb-28 md:pb-16">
      <header className="space-y-3 pt-4">
        <h1 className="text-3xl font-black">Les chiffres du mouvement</h1>
        <p className="text-lg leading-relaxed">
          Tout ce que Manifeste a recensé depuis le début du mouvement lycéen et étudiant. Tout est
          en accès libre : tu peux télécharger, reprendre et republier, sans nous demander.
        </p>
        {r && (
          <p className="text-sm text-muted">
            Chiffres arrêtés le {fmtDateTime(r.genere_le)}. Mis à jour toutes les cinq minutes.
          </p>
        )}
      </header>

      {resume.isError && (
        <p role="alert" className="rounded-lg border border-border p-3">
          Impossible de charger les chiffres pour le moment. Réessaie dans un instant.
        </p>
      )}

      {r && <KeyFigures r={r} />}

      <Section id="jours" title="Jour après jour">
        <p>
          Chaque barre compte les établissements signalés {ACTIVE_PHRASE} ce jour-là. Le jour est
          celui des faits, en heure de Paris, pas celui où on l'a appris.
        </p>
        {jours.data ? (
          <DailyBars jours={jours.data} />
        ) : (
          <div className="h-60 animate-pulse rounded-lg bg-surface" aria-busy="true" />
        )}
        {jours.data && (
          <details className="text-sm">
            <summary className="min-h-11 cursor-pointer py-2 underline underline-offset-4">
              Voir le tableau jour par jour
            </summary>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[30rem] text-left tabular-nums">
                <caption className="sr-only">Établissements signalés, jour par jour</caption>
                <thead className="border-b border-border text-muted">
                  <tr>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Jour
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">
                      Établissements
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">
                      Lycées
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">
                      Facs
                    </th>
                    <th scope="col" className="py-2 text-right font-medium">
                      Départements
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...jours.data].reverse().map((j) => (
                    <tr key={j.jour} className="border-b border-border/60">
                      <th scope="row" className="py-1.5 pr-3 font-normal">
                        {fmtDay(j.jour)}
                      </th>
                      <td className="py-1.5 pr-3 text-right font-semibold">
                        {fmtInt(j.etablissements)}
                      </td>
                      <td className="py-1.5 pr-3 text-right">{fmtInt(j.lycees)}</td>
                      <td className="py-1.5 pr-3 text-right">{fmtInt(j.facs)}</td>
                      <td className="py-1.5 text-right">{fmtInt(j.departements)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </Section>

      {r && (
        <Section id="origines" title="D'où viennent ces signalements">
          <p>
            Tous les signalements n'ont pas la même valeur, alors ils sont comptés séparément.
            Presque tout vient de la presse{partPresse}. Les signalements envoyés sur place restent
            rares.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <caption className="sr-only">Signalements par origine</caption>
              <thead className="border-b border-border text-muted">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Origine
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    Signalements
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    Établissements
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Ce que ça vaut
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.origines.map((o) => (
                  <tr key={o.origine} className="border-b border-border/60 align-top">
                    <th scope="row" className="py-2 pr-3 font-semibold">
                      {ORIGINE[o.origine]?.nom ?? o.origine}
                    </th>
                    <td className="py-2 pr-3 text-right tabular-nums">{fmtInt(o.signalements)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {fmtInt(o.etablissements)}
                    </td>
                    <td className="py-2 text-muted">{ORIGINE[o.origine]?.valeur}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted">
            Les exports gardent cette distinction : chaque signalement porte son origine. Un
            établissement peut apparaître dans plusieurs lignes, s'il a été signalé de plusieurs
            façons.
          </p>
        </Section>
      )}

      <Section id="academies" title="Par académie">
        {academies.data ? (
          <ZoneTable zones={academies.data} label="Académie" />
        ) : (
          <div className="h-48 animate-pulse rounded-lg bg-surface" aria-busy="true" />
        )}
      </Section>

      <Section id="departements" title="Par département">
        {departements.data ? (
          <ZoneTable zones={departements.data} label="Département" nameOf={departmentName} />
        ) : (
          <div className="h-48 animate-pulse rounded-lg bg-surface" aria-busy="true" />
        )}
      </Section>

      <Section id="lecture" title="Comment lire ces chiffres">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Ce sont des établissements <strong>signalés</strong>, pas un recensement. Un blocus que
            personne n'a raconté n'apparaît pas : le vrai nombre est plus grand.
          </li>
          <li>
            Un établissement est compté pour un jour s'il a au moins un signalement validé de
            blocage ou de barrage filtrant à cette date.
          </li>
          <li>
            Plus il y a de presse locale, plus on voit de blocus. Une académie bien couverte peut
            sembler plus mobilisée qu'une autre qui l'est autant.
          </li>
          <li>
            Les derniers jours se complètent encore : des articles paraissent après les faits.
          </li>
          <li>
            Une IA lit les articles et des personnes vérifient, mais on peut se tromper. Si tu
            repères une erreur, écris-nous.
          </li>
        </ul>
      </Section>

      <Section id="telecharger" title="Télécharger les données">
        <ExportSection />
      </Section>

      <Section id="licence" title="Licence : tout est réutilisable">
        <p>
          Ces données sont publiées sous licence{' '}
          <a
            href="https://creativecommons.org/licenses/by/4.0/deed.fr"
            className="underline"
            rel="noopener noreferrer"
          >
            Creative Commons BY 4.0
          </a>
          . Tu peux les copier, les modifier et les republier, dans un article, une étude, ou sur un
          autre site, à une seule condition : citer la source.
        </p>
        <p className="rounded-lg border border-border bg-surface p-3 text-sm">
          Source : Manifeste (manifeste.pandeo.fr), données libres sous licence CC BY 4.0.
        </p>
      </Section>

      <Section id="integrer" title="Mettre les chiffres ou la carte sur ton site">
        <EmbedSection />
      </Section>

      <p className="text-sm text-muted">
        Une question, une erreur, un besoin de chiffres particulier ?{' '}
        <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
          {CONTACT_EMAIL}
        </a>
      </p>
    </main>
  )
}

function KeyFigures({ r }: { r: Resume }) {
  const maintenant = r.en_ce_moment.bloques + r.en_ce_moment.filtrants
  return (
    <section aria-label="Chiffres clés">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-6 border-y border-border py-6 sm:grid-cols-3">
        <Figure value={fmtInt(r.etablissements)}>
          établissements signalés {ACTIVE_PHRASE}
          {r.premier_jour ? ` depuis le ${fmtDay(r.premier_jour)}` : ''}
        </Figure>
        {r.pic && (
          <Figure value={fmtInt(r.pic.etablissements)}>
            en une seule journée, le {fmtDay(r.pic.jour)} (dans {fmtInt(r.pic.departements)}{' '}
            départements)
          </Figure>
        )}
        <Figure value={fmtInt(r.departements)}>départements touchés</Figure>
        <Figure value={fmtInt(r.facs)}>facs et écoles supérieures signalées</Figure>
        <Figure value={fmtInt(maintenant)}>
          en ce moment, dont {fmtInt(r.en_ce_moment.bloques)}{' '}
          {blockedPhrase(r.en_ce_moment.bloques)}
        </Figure>
        <Figure value={fmtInt(r.sites_sources)}>sites de presse et sources différents</Figure>
        {(r.mobilises ?? 0) > 0 && (
          <Figure value={fmtInt(r.mobilises ?? 0)}>
            établissements de plus, avec une mobilisation signalée mais sans blocage ni fermeture
            confirmés
          </Figure>
        )}
      </dl>
    </section>
  )
}
