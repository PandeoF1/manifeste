import { createFileRoute, Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DEFAULT_SETTINGS, periodDescription } from '@/lib/periods'
import { settingsQuery } from '@/queries/settings'
import {
  CONTACT_EMAIL,
  CREATOR_GITHUB,
  CREATOR_NAME,
  HOST_SUPABASE,
  HOST_VERCEL,
} from '@/config/legal'

export const Route = createFileRoute('/a-propos')({
  component: AboutPage,
})

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="text-lg font-black">
        {title}
      </h2>
      <div className="space-y-3 leading-relaxed">{children}</div>
    </section>
  )
}

function AboutPage() {
  const { data: settings = DEFAULT_SETTINGS } = useQuery(settingsQuery)
  const mail = (
    <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
      {CONTACT_EMAIL}
    </a>
  )
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-8 overflow-y-auto p-4 pb-28 md:pb-16">
      <header className="space-y-2 pt-4">
        <h1 className="text-3xl font-black">C'est quoi, Manifeste ?</h1>
        <p className="text-lg">
          Une carte des lycées bloqués en France, en direct. Chaque point renvoie vers sa source.
        </p>
      </header>

      <Section id="methode" title="D'où viennent les infos">
        <p>
          Toutes les 10 minutes, le site lit la presse (nationale, régionale, locale) et des canaux
          Telegram et comptes Bluesky publics. Une IA (Google Gemini) repère les lycées cités et
          leur situation ; je ne garde que le lycée, le statut, l'heure et le lien. Tu peux aussi
          signaler un blocus sur place, ou me proposer un lycée qui manque : tout est vérifié à la
          main avant d'apparaître.
        </p>
        <p>
          Une info de la presse passe directement si le média est reconnu, ou si deux sources
          indépendantes la confirment à moins de 2 h d'écart. Je regarde aussi comment la presse
          parle du mouvement, pour mes propres stats, pas affichées.
        </p>
        <p>
          « Direct » retire un lycée après {settings.statusTtlHours} h sans nouveau signal. « 24 h
          », « 7 jours » et « Tout » donnent le bilan d'une période, avec le pire statut connu. «
          Tout » remonte {periodDescription('tout', settings)}.
        </p>
      </Section>

      <Section id="confidentialite" title="Confidentialité">
        <p>
          Pas de compte, pas de cookie, pas d'outil d'analyse tiers. Si tu signales un blocus, je
          garde le lycée, la situation, ta photo si tu en mets une et ta position arrondie à 100 m,
          uniquement pour vérifier que tu es sur place. Ton adresse IP n'est jamais enregistrée.
          Pour les stats, je compte les visites sans te suivre d'un jour à l'autre. Une photo
          publiée, une donnée à effacer : {mail}.
        </p>
        <details className="rounded-lg border border-border p-3 text-sm">
          <summary className="cursor-pointer font-semibold">Voir le détail</summary>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              Ta position n'est jamais affichée ni visible de quelqu'un d'autre que moi. Si tu
              proposes un lycée absent de la liste, je la garde jusqu'à ma décision, 7 jours au
              maximum.
            </li>
            <li>
              Ta photo est nettoyée sur ton téléphone (GPS, modèle d'appareil, date), floutée si
              besoin avant publication, et l'original est supprimé dès ma décision, 48 h au plus
              tard.
            </li>
            <li>
              Pour limiter les abus (5 envois par jour), je garde une empreinte de ton IP, mélangée
              à un secret détruit chaque nuit : impossible à retrouver.
            </li>
            <li>
              Stats : nombre de visiteurs par jour (même principe d'empreinte), pages vues, onglets
              ouverts en ce moment (identifiant aléatoire gardé en mémoire dans l'onglet) et vitesse
              du site. Rien sur ton navigateur ou ton appareil. « Do Not Track » ou « Global Privacy
              Control » les coupe.
            </li>
            <li>
              Quand une info de la presse n'a pas pu être rattachée à un lycée, je garde le titre et
              le chapeau de l'article 7 jours, le temps de vérifier.
            </li>
            <li>
              Cloudflare Turnstile (anti-robot du formulaire), Vercel et Supabase (hébergement) et
              OpenFreeMap (fond de carte) reçoivent, comme tout service en ligne, tes données
              techniques de connexion.
            </li>
            <li>
              Tu peux accéder à tes données, les faire corriger ou effacer en écrivant à {mail}, ou
              saisir la{' '}
              <a href="https://www.cnil.fr" className="underline" rel="noopener noreferrer">
                CNIL
              </a>
              .
            </li>
          </ul>
        </details>
      </Section>

      <Section id="mentions" title="Mentions légales">
        <p>
          Site édité à titre non professionnel par {CREATOR_NAME} (pseudonyme) ; mon identité a été
          communiquée aux hébergeurs, comme la loi le prévoit. Hébergement : {HOST_VERCEL} (site) et{' '}
          {HOST_SUPABASE} (base de données).
        </p>
        <p>
          Une erreur, un contenu illicite, une demande de retrait : {mail}. Manifeste recense des
          informations publiques avec leur source ; il n'organise aucun rassemblement et n'appelle à
          aucune action.
        </p>
      </Section>

      <p>
        <Link to="/" search={{}} className="btn-primary">
          Voir la carte
        </Link>
      </p>

      <p className="border-t border-border pt-4 text-sm text-muted">
        Un projet de {CREATOR_NAME} ·{' '}
        <a href={CREATOR_GITHUB} className="underline" rel="noopener noreferrer">
          GitHub
        </a>{' '}
        · {mail}
      </p>
    </main>
  )
}
