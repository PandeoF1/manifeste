import { lazy, Suspense, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { parseLatLng, type MovementEvent } from '@/lib/movements'
import { queryKeys } from '@/lib/queryKeys'
import { useTheme } from '@/lib/theme'
import {
  adminMovementsQuery,
  approveRouteProposal,
  patchRouteProposal,
  rejectRouteProposal,
  routeProposalsQuery,
  type RouteProposal,
} from '@/queries/admin'

const PAGE = 15
const MovementMap = lazy(() => import('@/components/movement/MovementMap'))

const PLACE_LABEL = { ok: 'Trouvé', weak: 'Incertain', none: 'Introuvable' } as const
const PLACE_CLASS = { ok: 'text-ok', weak: 'text-warn', none: 'text-poor' } as const
const TIMING_LABEL = { announced: 'Annoncé', ongoing: 'En cours', past: 'Passé' } as const
const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' })

/** What the preview map draws: the route (probable) and one point per place found. */
function previewEvents(p: RouteProposal): MovementEvent[] {
  const base = {
    kind: 'march' as const,
    place: null,
    status: 'planned' as const,
    startsAt: new Date('2099-01-01'),
    endsAt: null,
    sourceUrl: null,
    sourceDomain: null,
  }
  const route: MovementEvent[] = p.line
    ? [
        {
          ...base,
          id: `${p.id}:route`,
          title: p.title,
          lat: null,
          lng: null,
          route: p.line,
          routeBasis: 'probable',
        },
      ]
    : []
  const points = p.places.flatMap((pl, i): MovementEvent[] =>
    pl.lng != null && pl.lat != null
      ? [
          {
            ...base,
            id: `${p.id}:${i}`,
            title: `${i + 1}. ${pl.name}`,
            lat: pl.lat,
            lng: pl.lng,
            route: null,
            routeBasis: null,
            // A guess is drawn as already ended (grey): it must not look like a sure point.
            status: pl.status === 'ok' ? 'planned' : 'ended',
          },
        ]
      : [],
  )
  return [...route, ...points]
}

/**
 * Marches found in the press. Nothing is public until a person approves: check each point on
 * the map, correct what is wrong, then approve (it becomes a march with a "probable" route).
 */
export function RouteProposalsPanel() {
  const [view, setView] = useState<'pending' | 'decided'>('pending')
  const proposals = useQuery(routeProposalsQuery(view))
  const groups = useMemo(() => {
    const by = new Map<string, RouteProposal[]>()
    for (const p of proposals.data ?? []) by.set(p.groupKey, [...(by.get(p.groupKey) ?? []), p])
    // The ones with the fewest warnings first: the quickest to check.
    const warned = (g: RouteProposal[]) => Math.min(...g.map((p) => p.warnings.length))
    return [...by.values()].sort((a, b) => warned(a) - warned(b))
  }, [proposals.data])
  // One map at a time: every map is a WebGL context, and a browser gives up after a few dozen.
  const [openId, setOpenId] = useState<string | null>(null)
  const [shown, setShown] = useState(PAGE)

  return (
    <div className="mt-4 space-y-4">
      <p className="text-sm text-muted">
        La détection lit les articles et propose des cortèges avec leur parcours. Elle se trompe :
        les lieux comme les gares ou les préfectures sont mal placés une fois sur deux. Vérifie
        chaque point sur la carte avant d’approuver. L’interrupteur est dans Réglages ( « Détection
        des parcours »).
      </p>
      <div className="flex gap-2" role="tablist">
        {(['pending', 'decided'] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={view === v ? 'btn-primary' : 'btn-secondary'}
          >
            {v === 'pending' ? 'À vérifier' : 'Déjà traités'}
          </button>
        ))}
      </div>
      {proposals.isPending && <div className="h-32 animate-pulse rounded-xl bg-surface" />}
      {proposals.isError && (
        <p className="text-sm text-bloque" role="alert">
          Impossible de charger les parcours : {proposals.error.message}
        </p>
      )}
      {proposals.data?.length === 0 && (
        <p className="card text-sm text-muted">
          {view === 'pending' ? 'Aucun parcours à vérifier.' : 'Rien de traité pour l’instant.'}
        </p>
      )}
      {groups.slice(0, shown).map((group) => (
        <section key={group[0]?.groupKey} className="space-y-2">
          {group.length > 1 && view === 'pending' && (
            <p className="text-sm font-bold">
              {group.length} articles à {group[0]?.city}, {group[0]?.day ?? 'date inconnue'} :
              peut-être la même marche, peut-être plusieurs (une ville peut en avoir plusieurs le
              même jour). Compare avant de rejeter.
            </p>
          )}
          {group.map((p) => (
            <ProposalCard
              key={p.id}
              p={p}
              sameGroup={group.length > 1}
              open={openId === p.id}
              onToggle={() => setOpenId(openId === p.id ? null : p.id)}
            />
          ))}
        </section>
      ))}
      {groups.length > shown && (
        <button type="button" className="btn-secondary" onClick={() => setShown((n) => n + PAGE)}>
          Afficher plus ({groups.length - shown} marches restantes)
        </button>
      )}
    </div>
  )
}

function ProposalCard({
  p,
  sameGroup,
  open,
  onToggle,
}: {
  p: RouteProposal
  sameGroup: boolean
  open: boolean
  onToggle: () => void
}) {
  const queryClient = useQueryClient()
  const theme = useTheme()
  const pending = p.status === 'pending'
  const movements = useQuery(adminMovementsQuery)
  const active = movements.data?.filter((m) => m.status === 'active') ?? []
  const [title, setTitle] = useState(p.title)
  const [day, setDay] = useState(p.day ?? '')
  const [coords, setCoords] = useState(() =>
    p.places.map((pl) => (pl.lat != null && pl.lng != null ? `${pl.lat}, ${pl.lng}` : '')),
  )
  const [movementId, setMovementId] = useState('')
  const [time, setTime] = useState('14:00')
  const [rejectOthers, setRejectOthers] = useState(false)
  const [selected, setSelected] = useState<string | undefined>()
  const [error, setError] = useState<string | null>(null)
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: [...queryKeys.admin.all, 'route-proposals'] })
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e))

  const save = useMutation({
    mutationFn: () => {
      const places = p.places.map((pl, i) => {
        const text = coords[i] ?? ''
        const parsed = text.trim() ? parseLatLng(text) : null
        if (text.trim() && !parsed) throw new Error(`Coordonnées illisibles pour « ${pl.name} »`)
        return { name: pl.name, lng: parsed?.[0] ?? null, lat: parsed?.[1] ?? null }
      })
      return patchRouteProposal(p.id, { title, day: day || null, places })
    },
    onSuccess: () => {
      setError(null)
      return refresh()
    },
    onError: fail,
  })
  const approve = useMutation({
    mutationFn: () => {
      if (!movementId) throw new Error('Choisis le mouvement où publier ce cortège')
      if (!day) throw new Error('Indique le jour du cortège')
      return approveRouteProposal(p.id, {
        movementId,
        startsAt: new Date(`${day}T${time}`),
        rejectOthers: sameGroup && rejectOthers,
      })
    },
    onSuccess: () => {
      setError(null)
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.movements() })
      return refresh()
    },
    onError: fail,
  })
  const reject = useMutation({
    mutationFn: () => rejectRouteProposal(p.id),
    onSuccess: refresh,
    onError: fail,
  })

  const events = useMemo(() => previewEvents(p), [p])
  const now = useMemo(() => new Date('2098-01-01'), [])
  const dirty =
    title !== p.title ||
    day !== (p.day ?? '') ||
    coords.some((c, i) => {
      const pl = p.places[i]
      return c !== (pl && pl.lat != null && pl.lng != null ? `${pl.lat}, ${pl.lng}` : '')
    })
  const canApprove = Boolean(p.line) && p.places.every((pl) => pl.status === 'ok') && !dirty

  if (!open)
    return (
      <article className="card flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-bold">
            {p.title} <span className="font-normal text-muted">· {p.city}</span>
          </h3>
          <p className="text-xs text-muted">
            {p.day ? dateFmt.format(new Date(p.day)) : 'date inconnue'} · {p.domain} ·{' '}
            {p.places.length} lieux ·{' '}
            {p.warnings.length === 0
              ? 'rien à signaler'
              : `${p.warnings.length} point${p.warnings.length > 1 ? 's' : ''} à vérifier`}
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={onToggle}>
          {p.status === 'pending' ? 'Vérifier' : 'Voir'}
        </button>
      </article>
    )

  return (
    <article className="card space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-bold">
            {p.title} <span className="font-normal text-muted">· {p.city}</span>
          </h3>
          <p className="text-xs text-muted">
            {TIMING_LABEL[p.timing as keyof typeof TIMING_LABEL] ?? p.timing} ·{' '}
            {p.day ? dateFmt.format(new Date(p.day)) : 'date inconnue'}
            {p.lineKm != null && ` · ${p.lineKm.toFixed(1).replace('.', ',')} km à pied`}
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={onToggle}>
          Fermer
        </button>
        <a
          href={p.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm underline"
        >
          <ExternalLink size={14} aria-hidden="true" />
          {p.domain}
        </a>
      </header>
      {p.warnings.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-warn" aria-label="À vérifier">
          {p.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <div className="relative isolate h-64 overflow-hidden rounded-xl border border-border">
        <Suspense fallback={<div className="h-full animate-pulse bg-surface" />}>
          <MovementMap
            events={events}
            now={now}
            theme={theme}
            selectedId={selected}
            onSelect={setSelected}
            datasetKey={p.id + p.places.map((x) => `${x.lng}${x.lat}`).join()}
          />
        </Suspense>
      </div>
      <ol className="space-y-2">
        {p.places.map((pl, i) => (
          <li
            key={`${pl.name}-${i}`}
            className={`rounded-lg border p-2 text-sm ${selected === `${p.id}:${i}` ? 'border-fg' : 'border-border'}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold">
                {i + 1}. {pl.name}
              </span>
              <span className={PLACE_CLASS[pl.status]}>{PLACE_LABEL[pl.status]}</span>
            </div>
            <p className="mt-1 text-xs text-muted">« {pl.quote} »</p>
            {pl.label && <p className="text-xs text-muted">Trouvé : {pl.label}</p>}
            {pending && (
              <label className="mt-1 block text-xs">
                Coordonnées (latitude, longitude : clic droit sur une carte pour les copier)
                <input
                  className="input mt-1 w-full"
                  value={coords[i] ?? ''}
                  onChange={(e) =>
                    setCoords((c) => c.map((v, j) => (j === i ? e.target.value : v)))
                  }
                  inputMode="decimal"
                  placeholder="50.6296, 3.0706"
                />
              </label>
            )}
          </li>
        ))}
      </ol>
      {pending ? (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="text-sm sm:col-span-3">
              Titre
              <input
                className="input mt-1 w-full"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={160}
              />
            </label>
            <label className="text-sm">
              Jour
              <input
                className="input mt-1 w-full"
                type="date"
                value={day}
                onChange={(e) => setDay(e.target.value)}
              />
            </label>
            <label className="text-sm">
              Heure de départ
              <input
                className="input mt-1 w-full"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </label>
            <label className="text-sm">
              Publier dans
              <select
                className="input mt-1 w-full"
                value={movementId}
                onChange={(e) => setMovementId(e.target.value)}
              >
                <option value="">Choisir un mouvement…</option>
                {active.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {active.length === 0 && movements.data && (
            <p className="text-sm text-muted">
              Aucun mouvement actif : crée-en un dans « Mouvements ».
            </p>
          )}
          {sameGroup && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={rejectOthers}
                onChange={(e) => setRejectOthers(e.target.checked)}
              />
              Rejeter aussi les autres articles de cette ville et de ce jour (à ne cocher que si
              c’est la même marche)
            </label>
          )}
          {error && (
            <p className="text-sm text-bloque" role="alert">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary"
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? 'Calcul du trajet…' : 'Enregistrer les corrections'}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!canApprove || approve.isPending}
              onClick={() => approve.mutate()}
            >
              Approuver et publier
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={reject.isPending}
              onClick={() => reject.mutate()}
            >
              Rejeter
            </button>
          </div>
          {!canApprove && (
            <p className="text-xs text-muted">
              {dirty
                ? 'Enregistre tes corrections pour recalculer le trajet.'
                : 'Pour approuver : tous les lieux trouvés ou placés, et un trajet à pied calculé.'}
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">
          {p.status === 'approved' ? 'Approuvé : cortège créé.' : 'Rejeté.'}
        </p>
      )}
    </article>
  )
}
