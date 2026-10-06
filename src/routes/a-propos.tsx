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
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-9 overflow-y-auto p-4 pb-28 md:pb-16">
      <header className="space-y-3 pt-4">
        <h1 className="text-3xl font-black">C'est quoi, Manifeste ?</h1>
        <p className="text-lg">
          Une carte des lycées bloqués en France, mise à jour en direct. Tu vois où ça bloque,
          depuis quand, et d'où vient l'info : chaque point renvoie vers sa source.
        </p>
      </header>

      <Section id="methode" title="D'où viennent les infos">
        <p>
          Toutes les 10 minutes, le site lit des articles de presse (nationale, régionale, locale),
          des canaux Telegram publics et des comptes Bluesky. Une IA (Google Gemini) repère dans ces
          textes les lycées cités et leur situation : bloqué, barrage filtrant ou blocus levé. Je ne
          garde que le lycée, le statut, l'heure et le lien. Si le lycée n'a pas pu être identifié,
          un court extrait public (titre et chapeau) reste visible de moi seul pendant 7 jours, le
          temps de vérifier.
        </p>
        <p>
          Tu peux aussi signaler un blocus sur place, avec une photo si tu veux. Et si ton lycée
          n'est pas dans la liste, tu peux m'en proposer l'ajout. Tout signalement est vérifié à la
          main avant d'apparaître.
        </p>
        <p>
          Une info de la presse est publiée directement si elle vient d'un média reconnu, ou si deux
          sources indépendantes disent la même chose à moins de 2 heures d'écart. Sinon, je vérifie
          avant. Je regarde aussi comment la presse parle du mouvement (statistiques internes, non
          affichées sur le site).
        </p>
        <p>
          La carte « Direct » retire un lycée après {settings.statusTtlHours} heure
          {settings.statusTtlHours > 1 ? 's' : ''} sans nouveau signal. Les boutons « 24 h », « 7
          jours » et « Tout » donnent le bilan d'une période : chaque lycée concerné au moins une
          fois, avec le pire statut connu. « Tout » remonte {periodDescription('tout', settings)}.
        </p>
      </Section>

      <Section id="confidentialite" title="Ce que je garde sur toi">
        <p>
          Pas de compte, pas de cookie, pas de pisteur, aucun outil d'analyse tiers. Pour les
          détails :
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Quand tu signales un blocus</strong> : le lycée, la situation, et si tu en mets,
            un lien et une photo. Pas de nom, pas de pseudo.
          </li>
          <li>
            <strong>Ta position</strong> sert à vérifier que tu es à moins de 2 km du lycée. Elle
            est arrondie à environ 100 m sur ton téléphone avant l'envoi, jamais affichée, et vue de
            moi seul. Si tu proposes un lycée absent de la liste, elle est gardée jusqu'à ma
            décision (7 jours au maximum).
          </li>
          <li>
            <strong>Ta photo</strong> est nettoyée sur ton téléphone (GPS, modèle d'appareil et date
            supprimés) et le serveur la refuse s'il reste une métadonnée. Je la vérifie, je floute
            si besoin, et je supprime l'original dès ma décision, 48 heures au plus tard.
          </li>
          <li>
            <strong>Une empreinte anti-abus</strong> : une signature non réversible de ton adresse
            IP, mélangée à un sel secret détruit chaque nuit, ce qui limite les envois à 5 par jour.
            L'adresse IP elle-même n'est jamais enregistrée.
          </li>
          <li>
            <strong>Des statistiques de fréquentation anonymes</strong>, faites maison : combien de
            visiteurs par jour (même type d'empreinte, qui ne permet pas de te suivre d'un jour à
            l'autre), quelles pages sont vues, combien d'onglets sont ouverts en ce moment (via un
            identifiant aléatoire gardé en mémoire dans l'onglet, jamais sur ton appareil), et la
            vitesse d'affichage du site. Pas de navigateur, pas d'appareil, pas de lien entre
            visites. Tu peux les couper avec « Do Not Track » ou « Global Privacy Control » dans ton
            navigateur.
          </li>
          <li>
            Cloudflare Turnstile (anti-robot sur le formulaire), Vercel et Supabase (hébergement) et
            OpenFreeMap (fonds de carte) reçoivent, comme tout service en ligne, des données
            techniques de connexion.
          </li>
        </ul>
        <p>
          Pour accéder à tes données, les corriger ou les faire effacer, ou faire retirer une photo
          publiée, écris à {mail}. Tu peux aussi saisir la CNIL (
          <a href="https://www.cnil.fr" className="underline" rel="noopener noreferrer">
            cnil.fr
          </a>
          ).
        </p>
      </Section>

      <Section id="mentions" title="Mentions légales">
        <p>
          Manifeste est édité à titre non professionnel par {CREATOR_NAME} (pseudonyme). Comme la
          loi du 21 juin 2004 pour la confiance dans l'économie numérique le permet, mon identité
          complète a été communiquée aux hébergeurs, pas publiée ici.
        </p>
        <p>
          Hébergement : {HOST_VERCEL} pour le site ; {HOST_SUPABASE} pour la base de données.
        </p>
        <p>
          Contact, information inexacte, contenu illicite, demande de retrait : {mail}. Je réponds
          dès que possible.
        </p>
        <p>
          Manifeste recense des informations publiques sur des blocages d'établissements, avec leur
          source. Il n'organise aucun rassemblement et n'appelle à aucune action.
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
