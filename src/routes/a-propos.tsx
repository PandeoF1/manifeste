import { createFileRoute, Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { CONTACT_EMAIL, HOST_SUPABASE, HOST_VERCEL } from '@/config/legal'

export const Route = createFileRoute('/a-propos')({
  component: AboutPage,
})

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

function AboutPage() {
  const mail = (
    <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
      {CONTACT_EMAIL}
    </a>
  )
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-10 overflow-y-auto p-4 pb-16">
      <header className="space-y-3 pt-4">
        <h1 className="text-3xl font-black">Aucun lycée mobilisé n'est seul.</h1>
        <p className="text-lg">
          Manifest rend visible, en direct, chaque lycée bloqué en France. Ce qui se passe devant un
          établissement à Rennes, à Marseille ou à Lille apparaît sur la même carte, au même moment.
        </p>
        <p className="text-muted">
          Chaque point est sourcé. Rien n'est inventé, rien n'est exagéré : la carte montre ce qui
          est.
        </p>
      </header>

      <Section id="methode" title="D'où viennent les informations">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Presse et sources publiques.</strong> Des flux d'actualité, des canaux Telegram
            publics et des comptes Bluesky sont lus automatiquement toutes les 10 minutes. Une
            intelligence artificielle (Google Gemini) repère dans ces textes publics les lycées
            concernés et leur situation. Seuls le lycée, le statut, l'heure et le lien de la source
            sont gardés. Quand le lycée n'a pas pu être identifié automatiquement, un court extrait
            public (titre, chapeau de l'article) est conservé au plus 7 jours, visible de l'équipe
            uniquement, le temps de le vérifier.
          </li>
          <li>
            <strong>Signalements sur place.</strong> Toute personne près d'un lycée peut signaler la
            situation, avec une photo si elle le souhaite. Chaque signalement est vérifié à la main
            par l'équipe avant d'apparaître.
          </li>
        </ul>
        <p>
          <strong>Validation.</strong> Une information est publiée automatiquement si elle vient
          d'un média reconnu, ou si deux sources indépendantes la confirment dans un intervalle de 2
          heures. Sinon, l'équipe la vérifie avant publication.
        </p>
        <p>
          <strong>Expiration.</strong> Sans nouveau signal pendant 5 heures, un lycée disparaît de
          la carte. La carte montre la situation du moment, pas un historique.
        </p>
      </Section>

      <Section id="confidentialite" title="Confidentialité">
        <p>
          Manifest ne crée pas de compte, ne dépose aucun cookie de suivi et n'utilise aucun outil
          de mesure d'audience.
        </p>
        <p>Données traitées :</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Lors d'un signalement : le lycée, le statut et, si tu en ajoutes, le lien source et la
            photo. Aucune donnée d'identité : ni nom, ni pseudo, ni compte.
          </li>
          <li>
            <strong>Ta position</strong>, au moment du signalement : arrondie à environ 100 mètres,
            elle sert uniquement à vérifier que tu es à moins de 2 km du lycée. Elle n'est jamais
            affichée ; sur la carte, seul l'emplacement du lycée apparaît. Elle est visible
            uniquement par l'équipe de vérification.
          </li>
          <li>
            <strong>Ta photo</strong> : toutes ses métadonnées (position GPS, modèle de l'appareil,
            date) sont supprimées sur ton appareil avant l'envoi, et le serveur refuse toute photo
            qui en contiendrait encore. Tu peux flouter les visages avant l'envoi. L'équipe vérifie
            et floute à nouveau si besoin : une photo n'est publiée qu'après cette vérification.
            L'original est supprimé dès la décision de l'équipe, et au plus tard après 48 heures.
          </li>
          <li>
            Une empreinte chiffrée et non réversible de l'adresse IP, conservée 24 h, uniquement
            pour limiter les abus (intérêt légitime). L'adresse IP elle-même n'est jamais
            enregistrée.
          </li>
          <li>
            Cloudflare Turnstile vérifie que l'envoi vient d'un humain et traite à ce titre des
            données techniques de connexion.
          </li>
          <li>
            Les hébergeurs (Vercel, Supabase) conservent des journaux techniques de connexion.
          </li>
          <li>
            Les tuiles de la carte sont servies par OpenFreeMap, qui reçoit à ce titre des données
            techniques de connexion.
          </li>
        </ul>
        <p>
          Tu peux exercer tes droits d'accès, de rectification et d'effacement en écrivant à {mail},
          et introduire une réclamation auprès de la CNIL (
          <a href="https://www.cnil.fr" className="underline" rel="noopener noreferrer">
            cnil.fr
          </a>
          ). Une photo publiée peut être retirée sur simple demande.
        </p>
      </Section>

      <Section id="mentions" title="Mentions légales">
        <p>
          <strong>Éditeur.</strong> Manifest est édité à titre non professionnel par un particulier.
          Conformément à la loi n° 2004-575 du 21 juin 2004 pour la confiance dans l'économie
          numérique, l'éditeur a choisi de préserver son anonymat. Ses éléments d'identification ont
          été communiqués à l'hébergeur.
        </p>
        <p>
          <strong>Hébergement.</strong> Site : {HOST_VERCEL}. Base de données : {HOST_SUPABASE}.
        </p>
        <p>
          <strong>Contact et signalement.</strong> {mail} - point de contact unique pour toute
          question, pour signaler une information inexacte ou un contenu illicite, et pour toute
          demande de retrait. Les signalements sont traités dans les meilleurs délais.
        </p>
        <p>
          <strong>Nature du service.</strong> Manifest recense des informations publiques sur les
          blocages d'établissements, avec leur source. Le site n'organise aucun rassemblement et
          n'appelle à aucune action.
        </p>
      </Section>

      <p>
        <Link to="/" search={{}} className="btn-primary">
          Voir la carte
        </Link>
      </p>
    </main>
  )
}
