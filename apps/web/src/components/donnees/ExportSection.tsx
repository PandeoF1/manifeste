import { useState } from 'react'
import { Check, Copy, Download } from 'lucide-react'
import { API_VIEW } from '../../queries/donnees'

const SITE = 'https://manifeste.pandeo.fr'

interface Dataset {
  vue: keyof typeof API_VIEW
  titre: string
  contenu: string
  formats: Array<'csv' | 'json' | 'geojson'>
}

const DATASETS: Dataset[] = [
  {
    vue: 'jours',
    titre: 'Jour par jour',
    contenu:
      'Une ligne par jour : établissements signalés, départements touchés, lycées et facs, et la répartition par origine.',
    formats: ['csv', 'json'],
  },
  {
    vue: 'departements',
    titre: 'Par département',
    contenu: 'Établissements signalés, premier jour et situation en ce moment.',
    formats: ['csv', 'json'],
  },
  {
    vue: 'academies',
    titre: 'Par académie',
    contenu: 'Les mêmes chiffres, regroupés par académie.',
    formats: ['csv', 'json'],
  },
  {
    vue: 'etablissements',
    titre: 'Les établissements',
    contenu:
      'Un établissement par ligne, avec commune, académie, coordonnées, premier blocage, dernier statut connu et origines des signalements.',
    formats: ['csv', 'json', 'geojson'],
  },
  {
    vue: 'signalements',
    titre: 'Tous les signalements',
    contenu:
      'Un signalement par ligne : date du fait, établissement, statut, origine, site et lien de la source (jamais pour un signalement sur place).',
    formats: ['csv', 'json'],
  },
  {
    vue: 'resume',
    titre: 'Chiffres clés',
    contenu: 'Les totaux affichés en haut de cette page.',
    formats: ['csv', 'json'],
  },
]

const LABEL = { csv: 'CSV', json: 'JSON', geojson: 'GeoJSON' } as const

function useCopy(text: string) {
  const [done, setDone] = useState(false)
  const copy = () => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setDone(true)
        window.setTimeout(() => setDone(false), 1800)
      })
      .catch(() => undefined)
  }
  return { done, copy }
}

export function CopyBox({ code, label }: { code: string; label: string }) {
  const { done, copy } = useCopy(code)
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg border border-border bg-surface p-3 pr-24 text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
      <button
        type="button"
        onClick={copy}
        aria-label={label}
        className="absolute top-2 right-2 inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border bg-bg px-2.5 text-xs"
      >
        {done ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
        {done ? 'Copié' : 'Copier'}
      </button>
    </div>
  )
}

export function ExportSection() {
  return (
    <div className="space-y-6">
      <p className="rounded-lg border border-border bg-surface p-3 text-sm">
        <strong>Que veulent dire les colonnes ?</strong> Le{' '}
        <a className="font-semibold underline" href="/api/open-data?view=dictionary&format=txt">
          dictionnaire des données
        </a>{' '}
        définit chaque champ et chaque valeur : <code>categorie</code> (bloque, filtrant,
        mobilisation, leve), <code>confiance</code> et <code>origine</code> (presse, syndicat,
        collecteur, utilisateur).
      </p>
      <ul className="divide-y divide-border border-y border-border">
        {DATASETS.map((d) => (
          <li key={d.vue} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0 flex-1 basis-64">
              <h3 className="font-semibold">{d.titre}</h3>
              <p className="text-sm text-muted">{d.contenu}</p>
            </div>
            <div className="flex gap-2">
              {d.formats.map((f) => (
                <a
                  key={f}
                  href={`/api/open-data?view=${API_VIEW[d.vue]}&format=${f}&download=1`}
                  download
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-semibold hover:bg-surface"
                  aria-label={`Télécharger « ${d.titre} » au format ${LABEL[f]}`}
                >
                  <Download size={14} aria-hidden="true" /> {LABEL[f]}
                </a>
              ))}
            </div>
          </li>
        ))}
      </ul>

      <div className="space-y-2">
        <h3 className="font-semibold">Pour les développeurs</h3>
        <p className="text-sm">
          Les mêmes fichiers sont disponibles à une adresse stable, sans clé ni inscription. Les
          paramètres : <code>view</code> (summary, days, departments, academies, schools, reports,
          dictionary), <code>format</code> (json, csv, geojson pour les établissements ; txt pour le
          dictionnaire). La réponse est mise en cache cinq minutes ; merci de ne pas interroger plus
          souvent.
        </p>
        <CopyBox
          label="Copier la commande"
          code={`curl "${SITE}/api/open-data?view=days"\ncurl "${SITE}/api/open-data?view=schools&format=geojson" -o etablissements.geojson`}
        />
        <p className="text-sm text-muted">
          Les fichiers CSV utilisent le point-virgule et l'encodage UTF-8 : ils s'ouvrent
          directement dans Excel et LibreOffice.
        </p>
      </div>
    </div>
  )
}

export function EmbedSection() {
  const chiffres = `<iframe src="${SITE}/embed/chiffres" title="Manifeste : les chiffres du mouvement" width="100%" height="470" style="border:0;max-width:640px" loading="lazy"></iframe>`
  const carte = `<iframe src="${SITE}/embed/carte" title="Manifeste : carte des lycées et facs bloqués" width="100%" height="520" style="border:0" loading="lazy"></iframe>`
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="font-semibold">Les chiffres</h3>
        <p className="text-sm text-muted">
          Le nombre d'établissements bloqués en ce moment et la courbe jour par jour. Il se met à
          jour tout seul.
        </p>
        <iframe
          src="/embed/chiffres"
          title="Aperçu : les chiffres du mouvement"
          loading="lazy"
          className="h-[470px] w-full max-w-[640px] rounded-lg border border-border"
        />
        <CopyBox label="Copier le code des chiffres" code={chiffres} />
      </div>
      <div className="space-y-2">
        <h3 className="font-semibold">La carte</h3>
        <p className="text-sm text-muted">
          La carte en direct, sans les menus. Un clic sur un établissement ouvre sa fiche. Ajoute{' '}
          <code>?theme=clair</code> à l'adresse pour le fond clair.
        </p>
        <CopyBox label="Copier le code de la carte" code={carte} />
      </div>
    </div>
  )
}
