import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Link2, MapPin, Plus, Trash2 } from 'lucide-react'
import { MOBILISATION_LABEL, STATUS_LABELS } from '@/lib/labels'
import { queryKeys } from '@/lib/queryKeys'
import { formatSchoolName } from '@/lib/schoolName'
import {
  proposalPhotoUrl,
  proposalsQuery,
  rejectProposal,
  resolveProposal,
  type Proposal,
} from '@/queries/admin'

const dateFmt = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Europe/Paris',
})
const km = (m: number | null) =>
  m == null ? '' : m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`

/**
 * Schools proposed by visitors (missing from the list): attach to an existing school,
 * create the school, or reject. The signal then goes to Moderation.
 */
export function ProposalsPanel({ canReject = true }: { canReject?: boolean }) {
  const proposals = useQuery(proposalsQuery)
  return (
    <div className="mt-4 space-y-4">
      <p className="text-sm text-muted">
        Un visiteur n'a pas trouvé son établissement et l'a saisi lui-même. Vérifie : souvent il
        existe sous un autre nom (voir les établissements proches). Après ta décision, le signal
        arrive en Modération. Sans décision, la proposition est supprimée au bout de 7 jours.
        {!canReject && ' Si elle ne tient pas, laisse-la : un administrateur la rejettera.'}
      </p>
      {proposals.isPending && <div className="h-32 animate-pulse rounded-xl bg-surface" />}
      {proposals.isError && (
        <p className="text-sm text-bloque" role="alert">
          Impossible de charger les propositions : {proposals.error.message}
        </p>
      )}
      {proposals.data?.length === 0 && (
        <p className="card text-sm text-muted">Aucune proposition en attente.</p>
      )}
      {proposals.data?.map((p) => (
        <ProposalCard key={p.id} p={p} canReject={canReject} />
      ))}
    </div>
  )
}

function ProposalCard({ p, canReject }: { p: Proposal; canReject: boolean }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(() => formatSchoolName(p.name))
  const [city, setCity] = useState(p.city)
  const [uai, setUai] = useState('')
  const [showPhoto, setShowPhoto] = useState(false)
  const done = () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.all })

  const resolve = useMutation({
    mutationFn: (args: { link?: string; create?: boolean }) =>
      resolveProposal(p.id, {
        ...(args.link && { linkUai: args.link }),
        ...(args.create && { name, city, ...(uai.trim() && { newUai: uai.trim().toUpperCase() }) }),
      }),
    onSuccess: done,
  })
  const reject = useMutation({
    mutationFn: () => rejectProposal(p.id),
    onSuccess: done,
  })
  const busy = resolve.isPending || reject.isPending

  return (
    <article className="card space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">
            « {p.name} » · {p.city}
          </h2>
          <p className="text-xs text-muted">
            {p.mobilisation ? MOBILISATION_LABEL : STATUS_LABELS[p.status]} ·{' '}
            {dateFmt.format(p.createdAt)} ·{' '}
            <a
              className="inline-flex items-center gap-1 underline"
              href={`https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=16/${p.lat}/${p.lng}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <MapPin size={12} aria-hidden="true" /> position du visiteur (~100 m)
            </a>
            {p.sourceUrl && (
              <>
                {' · '}
                <a
                  className="inline-flex items-center gap-1 underline"
                  href={p.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  source <ExternalLink size={12} aria-hidden="true" />
                </a>
              </>
            )}
          </p>
        </div>
        {canReject && (
          <button
            type="button"
            className="btn-secondary min-h-10 px-3 text-sm"
            disabled={busy}
            onClick={() => {
              if (window.confirm('Rejeter cette proposition ? Le signal est abandonné.'))
                reject.mutate()
            }}
          >
            <Trash2 size={16} aria-hidden="true" /> Rejeter
          </button>
        )}
      </header>

      {p.hasPhoto &&
        (showPhoto ? (
          <img
            src={proposalPhotoUrl(p.id)}
            alt="Photo envoyée (non floutée)"
            className="max-h-64 rounded-lg"
          />
        ) : (
          <button type="button" className="text-sm underline" onClick={() => setShowPhoto(true)}>
            Voir la photo
          </button>
        ))}

      <section>
        <h3 className="text-sm font-semibold">C'est peut-être…</h3>
        {p.candidates.length === 0 && (
          <p className="text-sm text-muted">Aucun établissement proche ou de nom voisin.</p>
        )}
        <ul className="mt-1 divide-y divide-border rounded-lg border border-border">
          {p.candidates.map((c) => (
            <li key={c.uai} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0 text-sm">
                <span className="font-medium">{c.name}</span>
                <span className="text-muted">
                  {' '}
                  · {c.city}
                  {c.distanceM != null ? ` · ${km(c.distanceM)}` : ''}
                </span>
              </span>
              <button
                type="button"
                className="btn-secondary min-h-9 shrink-0 px-3 text-sm"
                disabled={busy}
                onClick={() => resolve.mutate({ link: c.uai })}
              >
                <Link2 size={14} aria-hidden="true" /> Rattacher
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Ou ajouter l'établissement</h3>
        <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr]">
          <label className="text-xs text-muted">
            Nom (mis en forme, modifiable)
            <input
              className="input mt-1 w-full text-sm text-fg"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="text-xs text-muted">
            Ville
            <input
              className="input mt-1 w-full text-sm text-fg"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            />
          </label>
          <label className="text-xs text-muted">
            UAI (facultatif)
            <input
              className="input mt-1 w-full text-sm text-fg uppercase"
              value={uai}
              placeholder="0123456A"
              maxLength={8}
              onChange={(e) => setUai(e.target.value)}
            />
          </label>
        </div>
        <p className="text-xs text-muted">
          Placé à la position du visiteur (à ~100 m près). Sans UAI, un identifiant interne 999xxxxZ
          est attribué. L'UAI se trouve sur l'annuaire de l'éducation ou de l'agriculture.
        </p>
        <button
          type="button"
          className="btn-primary min-h-10 px-4 text-sm"
          disabled={busy || name.trim().length < 3 || city.trim().length < 1}
          onClick={() => resolve.mutate({ create: true })}
        >
          <Plus size={16} aria-hidden="true" /> Ajouter « {name} » et envoyer en modération
        </button>
      </section>

      {(resolve.error || reject.error) && (
        <p className="text-sm text-bloque" role="alert">
          {(resolve.error ?? reject.error)?.message}
        </p>
      )}
    </article>
  )
}
