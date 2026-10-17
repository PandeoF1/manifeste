import { useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { EVENT_KINDS, EVENT_STATUSES, ROUTE_BASES } from '@manifeste/core'
import {
  EVENT_KIND_LABEL,
  EVENT_STATUS_LABEL,
  parseRouteText,
  ROUTE_BASIS_LABEL,
  routeLengthLabel,
  shownStatus,
  type MovementEvent,
} from '@/lib/movements'
import { queryKeys } from '@/lib/queryKeys'
import {
  addMovementEvent,
  adminMovementsQuery,
  createMovement,
  movementEventsStaffQuery,
  patchMovement,
  patchMovementEvent,
} from '@/queries/admin'
import { settingsQuery } from '@/queries/settings'

const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' })
const dateTimeFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' })

/** A date field value ("2026-10-17" or "2026-10-17T14:00", local time) as a Date, or undefined. */
const dateOf = (value: FormDataEntryValue | null): Date | undefined => {
  const text = String(value ?? '').trim()
  if (!text) return undefined
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? undefined : date
}

const numberOf = (value: FormDataEntryValue | null): number | undefined => {
  const text = String(value ?? '')
    .trim()
    .replace(',', '.')
  if (!text) return undefined
  const n = Number(text)
  return Number.isFinite(n) ? n : undefined
}

/** Movements and their events: create, archive, add marches with a route, hide or cancel events. */
export function MovementsPanel() {
  const queryClient = useQueryClient()
  const movements = useQuery(adminMovementsQuery)
  const publicOn = useQuery(settingsQuery).data?.movementsPublic ?? false
  const [openId, setOpenId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.admin.movements() })
    return queryClient.invalidateQueries({ queryKey: queryKeys.movements.all })
  }

  const create = useMutation({ mutationFn: createMovement, onSuccess: refresh })
  const patch = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'archived' }) =>
      patchMovement(id, { status }),
    onSuccess: refresh,
  })

  function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const data = new FormData(form)
    const startsAt = dateOf(data.get('startsAt'))
    if (!startsAt) return setError('Date de début requise.')
    setError(null)
    create.mutate(
      {
        name: String(data.get('name') ?? '').trim(),
        description: String(data.get('description') ?? '').trim() || undefined,
        startsAt,
      },
      { onSuccess: () => form.reset() },
    )
  }

  return (
    <div className="space-y-4">
      {!publicOn && (
        <p className="rounded-lg border border-border bg-surface p-3 text-sm">
          La page Mouvements est <strong>masquée au public</strong> : tu peux préparer ici des
          mouvements et des événements, les visiteurs ne les voient pas. Pour l'afficher, active le
          réglage « Page Mouvements publique » dans{' '}
          <Link to="/admin" search={{ tab: 'reglages' }} className="underline">
            Réglages
          </Link>
          .
        </p>
      )}

      <form onSubmit={onCreate} className="card grid gap-3 md:grid-cols-[2fr_3fr_auto_auto]">
        <input
          name="name"
          required
          minLength={3}
          placeholder="Nom (ex. Lycéens, automne 2026)"
          className="input"
          aria-label="Nom du mouvement"
        />
        <input
          name="description"
          placeholder="Description (facultatif)"
          className="input"
          aria-label="Description"
        />
        <input name="startsAt" type="date" required className="input" aria-label="Début" />
        <button type="submit" className="btn-primary" disabled={create.isPending}>
          Créer
        </button>
        {(error || create.error) && (
          <p role="alert" className="text-sm text-bloque md:col-span-4">
            {error ?? create.error?.message}
          </p>
        )}
      </form>

      {movements.data?.length === 0 && <p className="text-muted">Aucun mouvement.</p>}
      <ul className="space-y-3">
        {movements.data?.map((m) => (
          <li key={m.id} className="card space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex-1">
                <p className="font-bold">
                  {m.name}{' '}
                  <span className="text-sm font-normal text-muted">
                    · {m.status === 'active' ? 'en cours' : 'archivé'}
                  </span>
                </p>
                <p className="text-sm text-muted">
                  {dateFmt.format(m.startsAt)}
                  {m.endsAt ? ` - ${dateFmt.format(m.endsAt)}` : ''} · {m.eventCount} publié
                  {m.eventCount > 1 ? 's' : ''} ·{' '}
                  {publicOn ? (
                    <a href={`/mouvements/${m.slug}`} className="underline">
                      /mouvements/{m.slug}
                    </a>
                  ) : (
                    <span>/mouvements/{m.slug}</span>
                  )}
                </p>
              </div>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setOpenId(openId === m.id ? null : m.id)}
                aria-expanded={openId === m.id}
              >
                Événements
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={patch.isPending}
                onClick={() =>
                  patch.mutate({ id: m.id, status: m.status === 'active' ? 'archived' : 'active' })
                }
              >
                {m.status === 'active' ? 'Archiver' : 'Rouvrir'}
              </button>
            </div>
            {patch.error && (
              <p role="alert" className="text-sm text-bloque">
                {patch.error.message}
              </p>
            )}
            {openId === m.id && <EventsEditor movementId={m.id} />}
          </li>
        ))}
      </ul>
    </div>
  )
}

function EventsEditor({ movementId }: { movementId: string }) {
  const queryClient = useQueryClient()
  const events = useQuery(movementEventsStaffQuery(movementId))
  const [error, setError] = useState<string | null>(null)
  const [routeText, setRouteText] = useState('')
  const now = new Date()
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.admin.movementEvents(movementId) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.admin.movements() })
    void queryClient.invalidateQueries({ queryKey: queryKeys.movements.all })
  }
  const add = useMutation({
    mutationFn: (b: Parameters<typeof addMovementEvent>[1]) => addMovementEvent(movementId, b),
    onSuccess: refresh,
  })
  const edit = useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Parameters<typeof patchMovementEvent>[1]) =>
      patchMovementEvent(id, body),
    onSuccess: refresh,
  })

  const parsed = parseRouteText(routeText)
  const preview =
    parsed.ok && parsed.route ? routeLengthLabel({ route: parsed.route } as MovementEvent) : null

  function onAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const data = new FormData(form)
    const startsAt = dateOf(data.get('startsAt'))
    if (!startsAt) return setError('Date et heure de début requises.')
    if (!parsed.ok) return setError(parsed.error)
    const basis = String(data.get('routeBasis') ?? '')
    if (parsed.route && !basis) return setError('Dis si le parcours est annoncé ou probable.')
    const lat = numberOf(data.get('lat'))
    const lng = numberOf(data.get('lng'))
    if ((lat === undefined) !== (lng === undefined))
      return setError('Latitude et longitude vont ensemble.')
    setError(null)
    add.mutate(
      {
        kind: String(data.get('kind')) as (typeof EVENT_KINDS)[number],
        title: String(data.get('title') ?? '').trim(),
        place: String(data.get('place') ?? '').trim() || undefined,
        startsAt,
        endsAt: dateOf(data.get('endsAt')),
        lat,
        lng,
        ...(parsed.route && {
          route: parsed.route,
          routeBasis: basis as (typeof ROUTE_BASES)[number],
        }),
        sourceUrl: String(data.get('sourceUrl') ?? '').trim() || undefined,
      },
      {
        onSuccess: () => {
          form.reset()
          setRouteText('')
        },
      },
    )
  }

  return (
    <div className="space-y-3 border-t border-border pt-3">
      {events.isPending && <p className="text-muted">Chargement…</p>}
      {events.data?.length === 0 && <p className="text-muted">Aucun événement.</p>}
      <ul className="divide-y divide-border rounded-lg border border-border">
        {events.data?.map((ev) => (
          <li key={ev.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className={`font-medium ${ev.hidden ? 'text-muted line-through' : ''}`}>
                {ev.title}
              </p>
              <p className="text-sm text-muted">
                {EVENT_KIND_LABEL[ev.kind]} · {dateTimeFmt.format(ev.startsAt)}
                {ev.place ? ` · ${ev.place}` : ''}
                {ev.route && ev.routeBasis
                  ? ` · ${ROUTE_BASIS_LABEL[ev.routeBasis]} · ${routeLengthLabel(ev) ?? ''}`
                  : ''}
                {shownStatus(ev, now) !== ev.status
                  ? ` · affiché : ${EVENT_STATUS_LABEL[shownStatus(ev, now)]}`
                  : ''}
                {ev.hidden ? ' · masqué' : ''}
              </p>
            </div>
            <select
              className="input w-auto"
              aria-label={`Statut de ${ev.title}`}
              value={ev.status}
              onChange={(e) =>
                edit.mutate({
                  id: ev.id,
                  status: e.target.value as (typeof EVENT_STATUSES)[number],
                })
              }
            >
              {EVENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {EVENT_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => edit.mutate({ id: ev.id, hidden: !ev.hidden })}
            >
              {ev.hidden ? 'Afficher' : 'Masquer'}
            </button>
          </li>
        ))}
      </ul>
      {edit.error && (
        <p role="alert" className="text-sm text-bloque">
          {edit.error.message}
        </p>
      )}

      <form onSubmit={onAdd} className="grid gap-3 md:grid-cols-2">
        <select name="kind" className="input" aria-label="Type" defaultValue="march">
          {EVENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {EVENT_KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <input
          name="title"
          required
          minLength={3}
          placeholder="Titre"
          className="input"
          aria-label="Titre"
        />
        <input
          name="place"
          placeholder="Lieu (ex. Paris 11e)"
          className="input"
          aria-label="Lieu"
        />
        <input
          name="sourceUrl"
          type="url"
          placeholder="Lien source https://…"
          className="input"
          aria-label="Source"
        />
        <label className="flex flex-col text-sm text-muted">
          Début
          <input name="startsAt" type="datetime-local" required className="input mt-1" />
        </label>
        <label className="flex flex-col text-sm text-muted">
          Fin (facultatif)
          <input name="endsAt" type="datetime-local" className="input mt-1" />
        </label>
        <input
          name="lat"
          inputMode="decimal"
          placeholder="Latitude du point de départ"
          className="input"
          aria-label="Latitude"
        />
        <input
          name="lng"
          inputMode="decimal"
          placeholder="Longitude"
          className="input"
          aria-label="Longitude"
        />
        <label className="flex flex-col text-sm text-muted md:col-span-2">
          Parcours (facultatif) : un point par ligne, « latitude, longitude » comme dans Google Maps
          <textarea
            value={routeText}
            onChange={(e) => setRouteText(e.target.value)}
            rows={4}
            placeholder={'48.8675, 2.3637\n48.8483, 2.3959'}
            className="input mt-1 w-full font-mono"
          />
        </label>
        {preview && (
          <p className="text-sm md:col-span-2">
            Parcours lu : {parsed.ok && parsed.route ? parsed.route.length : 0} points, {preview}.
            Vérifie que la longueur est plausible (une latitude et une longitude inversées donnent
            souvent un parcours aberrant).
          </p>
        )}
        {routeText.trim() && !parsed.ok && (
          <p role="alert" className="text-sm text-bloque md:col-span-2">
            {parsed.error}
          </p>
        )}
        {routeText.trim() && (
          <select
            name="routeBasis"
            className="input md:col-span-2"
            aria-label="Fiabilité du parcours"
            defaultValue=""
          >
            <option value="" disabled>
              Fiabilité du parcours…
            </option>
            {ROUTE_BASES.map((b) => (
              <option key={b} value={b}>
                {ROUTE_BASIS_LABEL[b]}
              </option>
            ))}
          </select>
        )}
        {(error || add.error) && (
          <p role="alert" className="text-sm text-bloque md:col-span-2">
            {error ?? add.error?.message}
          </p>
        )}
        <button type="submit" className="btn-primary md:col-span-2" disabled={add.isPending}>
          Ajouter l'événement
        </button>
      </form>
    </div>
  )
}
