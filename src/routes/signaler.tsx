import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Camera, Check, LocateFixed, MapPin, ShieldCheck } from 'lucide-react'
import { z } from 'zod'
import { REPORT_STATUSES, STATUS_LABELS, type ReportStatus } from '@shared/status.ts'
import { roundCoord, submissionFieldsSchema } from '@shared/submission.ts'
import { StatusIcon } from '@/components/status/StatusIcon'
import { PhotoRedactor } from '@/components/report/PhotoRedactor'
import { Turnstile, turnstileEnabled } from '@/components/report/Turnstile'
import { loadImage, toJpeg } from '@/lib/photo'
import { nearbySchoolsQuery, searchSchoolsQuery, submitReport, SubmitError } from '@/queries/report'

export const Route = createFileRoute('/signaler')({
  validateSearch: z.object({
    uai: z
      .string()
      .regex(/^[0-9]{7}[A-Z]$/)
      .optional()
      .catch(undefined),
  }),
  component: ReportPage,
})

type Position = { lat: number; lng: number; accuracy: number }
type School = { uai: string; name: string; city: string; distance_m?: number }

const STATUS_HELP: Record<ReportStatus, string> = {
  bloque: "L'entrée de l'établissement est bloquée",
  filtrant: 'Barrage filtrant, entrée partielle',
  leve: 'Le blocus est terminé',
}

function ReportPage() {
  const { uai: preferredUai } = Route.useSearch()
  const [position, setPosition] = useState<Position | null>(null)
  const [geoError, setGeoError] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)
  const [school, setSchool] = useState<School | null>(null)
  /** Lycée absent de la liste : nom et ville saisis (vérifiés par l'équipe). */
  const [customSchool, setCustomSchool] = useState<{ name: string; city: string } | null>(null)
  const [status, setStatus] = useState<ReportStatus | null>(null)
  const [photo, setPhoto] = useState<HTMLCanvasElement | null>(null)
  const [redacted, setRedacted] = useState<HTMLCanvasElement | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [sourceUrl, setSourceUrl] = useState('')
  const [token, setToken] = useState<string | null>(null)
  const [turnstileKey, setTurnstileKey] = useState(0)
  const [formError, setFormError] = useState<string | null>(null)

  const submit = useMutation({
    mutationFn: submitReport,
    onError: () => {
      setToken(null)
      setTurnstileKey((k) => k + 1)
    },
  })

  function locate() {
    if (!('geolocation' in navigator)) {
      setGeoError("La localisation n'est pas disponible sur cet appareil.")
      return
    }
    setLocating(true)
    setGeoError(null)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false)
        setPosition({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
        })
      },
      (err) => {
        setLocating(false)
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? 'Localisation refusée. Autorise-la dans ton navigateur pour signaler un blocus sur place.'
            : 'Impossible de te localiser. Réessaie à l’extérieur ou dans un instant.',
        )
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    )
  }

  async function onPhoto(file: File | undefined) {
    setPhotoError(null)
    if (!file) return
    try {
      setPhoto(await loadImage(file))
    } catch {
      setPhotoError('Cette image ne peut pas être lue. Essaie une photo JPEG ou PNG.')
    }
  }
  const onRedacted = useCallback((c: HTMLCanvasElement) => setRedacted(c), [])
  const onToken = useCallback((t: string | null) => setToken(t), [])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!position) return setFormError("Active ta localisation : c'est elle qui situe le blocus.")
    if (!school && !customSchool) return setFormError("Choisis l'établissement concerné.")
    if (!status) return setFormError('Choisis la situation.')
    if (turnstileEnabled && !token) return setFormError('Termine la vérification anti-robot.')
    const fields = submissionFieldsSchema.safeParse({
      ...(customSchool
        ? { new_school_name: customSchool.name, new_school_city: customSchool.city }
        : { school_uai: school?.uai }),
      status,
      lat: position.lat,
      lng: position.lng,
      source_url: sourceUrl,
      turnstile_token: token ?? undefined,
    })
    if (!fields.success)
      return setFormError(fields.error.issues[0]?.message ?? 'Formulaire invalide.')

    const form = new FormData()
    if (fields.data.school_uai) form.set('school_uai', fields.data.school_uai)
    if (fields.data.new_school_name) form.set('new_school_name', fields.data.new_school_name)
    if (fields.data.new_school_city) form.set('new_school_city', fields.data.new_school_city)
    form.set('status', fields.data.status)
    // Arrondi à ~100 m dès le téléphone : la position exacte ne quitte jamais l'appareil.
    form.set('lat', String(roundCoord(fields.data.lat)))
    form.set('lng', String(roundCoord(fields.data.lng)))
    if (fields.data.source_url) form.set('source_url', fields.data.source_url)
    if (token) form.set('turnstile_token', token)
    if (redacted) form.set('photo', await toJpeg(redacted), 'photo.jpg')
    submit.mutate(form)
  }

  if (submit.isSuccess) {
    return (
      <main className="mx-auto w-full max-w-xl flex-1 overflow-y-auto p-6">
        <div className="card space-y-3 text-center">
          <Check className="mx-auto text-bloque" size={40} aria-hidden="true" />
          <h1 className="text-2xl font-black">Merci, c'est envoyé.</h1>
          <p>
            Ton signalement est entre les mains de l'équipe. Il apparaîtra sur la carte une fois
            vérifié, photo floutée comprise. Aucune information sur toi n'a été conservée.
          </p>
          {customSchool && (
            <p className="text-sm text-muted">
              L'établissement « {customSchool.name} » sera ajouté à la carte après vérification.
            </p>
          )}
          <Link to="/" search={{}} className="btn-primary">
            Voir la carte
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto w-full max-w-xl flex-1 overflow-y-auto p-4 pb-[calc(4rem+env(safe-area-inset-bottom))]">
      <h1 className="text-2xl font-black">Signaler un blocus</h1>
      <p className="mt-1 text-muted">
        Tu es devant ton lycée ou ta fac ? Fais-le savoir : chaque signalement vérifié rejoint la
        carte nationale.
      </p>

      <PrivacyNotice />

      <form onSubmit={onSubmit} className="mt-6 space-y-8" noValidate>
        <fieldset className="space-y-3">
          <legend className="text-lg font-bold">1. Où es-tu ?</legend>
          {position ? (
            <p className="flex items-center gap-2 text-sm">
              <MapPin size={18} className="text-bloque" aria-hidden="true" />
              Position trouvée (précision ~{Math.round(position.accuracy)} m).
              <button type="button" className="underline" onClick={locate}>
                Actualiser
              </button>
            </p>
          ) : (
            <button
              type="button"
              className="btn-primary w-full"
              onClick={locate}
              disabled={locating}
            >
              <LocateFixed size={18} /> {locating ? 'Localisation…' : 'Me localiser'}
            </button>
          )}
          {geoError && (
            <p role="alert" className="text-sm text-filtrant">
              {geoError}
            </p>
          )}
          <p className="text-xs text-muted">
            Ta position sert uniquement à vérifier que tu es près de l'établissement. Elle est
            arrondie à ~100 m et n'est jamais affichée.
          </p>
        </fieldset>

        {position && (
          <SchoolPicker
            position={position}
            preferredUai={preferredUai}
            selected={school}
            onSelect={(s) => {
              setCustomSchool(null)
              setSchool(s)
            }}
            custom={customSchool}
            onCustom={(c) => {
              setCustomSchool(c)
              if (c) setSchool(null)
            }}
          />
        )}

        <fieldset className="space-y-3">
          <legend className="text-lg font-bold">3. Que se passe-t-il ?</legend>
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
            {REPORT_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={status === s}
                onClick={() => setStatus(s)}
                className="flex min-h-20 flex-col items-start justify-center gap-1 rounded-xl border-2 border-border bg-surface p-3 text-left aria-checked:border-bloque"
              >
                <span className="flex items-center gap-2 font-bold">
                  <StatusIcon status={s} size={20} /> {STATUS_LABELS[s]}
                </span>
                <span className="text-xs text-muted">{STATUS_HELP[s]}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-lg font-bold">
            4. Une photo <span className="font-normal text-muted">(facultatif)</span>
          </legend>
          {photo ? (
            <PhotoRedactor
              image={photo}
              onChange={onRedacted}
              onRemove={() => {
                setPhoto(null)
                setRedacted(null)
              }}
            />
          ) : (
            <label className="btn-secondary w-full cursor-pointer">
              <Camera size={18} /> Prendre ou choisir une photo
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={(e) => void onPhoto(e.target.files?.[0])}
              />
            </label>
          )}
          {photoError && (
            <p role="alert" className="text-sm text-filtrant">
              {photoError}
            </p>
          )}
          <p className="text-xs text-muted">
            Photographie plutôt l'entrée, les poubelles, les banderoles que les personnes. Pas de
            visage reconnaissable : floute-les ci-dessus.
          </p>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-lg font-bold">
            5. Un lien <span className="font-normal text-muted">(facultatif)</span>
          </legend>
          <label className="field">
            Article ou post public qui en parle
            <input
              type="url"
              inputMode="url"
              className="input"
              placeholder="https://"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
            />
          </label>
        </fieldset>

        <Turnstile onToken={onToken} resetKey={turnstileKey} />

        {(formError || submit.error) && (
          <p role="alert" className="rounded-lg border border-bloque p-3 text-sm">
            {formError ??
              (submit.error instanceof SubmitError ? submit.error.message : 'Erreur inattendue.')}
          </p>
        )}

        <button type="submit" className="btn-primary w-full text-lg" disabled={submit.isPending}>
          {submit.isPending ? 'Envoi…' : 'Envoyer le signalement'}
        </button>
      </form>
    </main>
  )
}

function SchoolPicker({
  position,
  preferredUai,
  selected,
  onSelect,
  custom,
  onCustom,
}: {
  position: Position
  preferredUai: string | undefined
  selected: School | null
  onSelect: (s: School) => void
  custom: { name: string; city: string } | null
  onCustom: (c: { name: string; city: string } | null) => void
}) {
  const nearby = useQuery(nearbySchoolsQuery(position.lat, position.lng))
  const [query, setQuery] = useState('')
  const search = useQuery(searchSchoolsQuery(query))
  // Lycée venu de la carte s'il est à portée, sinon le plus proche.
  const nearest = nearby.data?.find((s) => s.uai === preferredUai) ?? nearby.data?.[0]

  // Pré-sélection.
  useEffect(() => {
    if (!selected && !custom && nearest) onSelect(nearest)
  }, [nearest, selected, custom, onSelect])

  const list: School[] = query.trim().length >= 2 ? (search.data ?? []) : (nearby.data ?? [])

  return (
    <fieldset className="space-y-3">
      <legend className="text-lg font-bold">2. Quel établissement ?</legend>
      {nearby.isPending && <div className="h-14 animate-pulse rounded-lg bg-surface" />}
      {nearby.data?.length === 0 && !query && (
        <p className="text-sm text-muted">
          Aucun établissement à moins de 2 km. Cherche-le par son nom :
        </p>
      )}
      <input
        type="search"
        className="input w-full"
        placeholder="Chercher un lycée ou une fac (nom, ville)"
        aria-label="Chercher un établissement"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul
        className="divide-y divide-border rounded-lg border border-border bg-surface"
        role="radiogroup"
      >
        {list.map((s) => (
          <li key={s.uai}>
            <button
              type="button"
              role="radio"
              aria-checked={selected?.uai === s.uai}
              onClick={() => onSelect(s)}
              className="flex min-h-14 w-full items-center justify-between gap-3 px-3 py-2 text-left aria-checked:bg-bg"
            >
              <span className="min-w-0">
                <span className="line-clamp-2 font-medium break-words">{s.name}</span>
                <span className="block text-sm text-muted">
                  {s.city}
                  {s.distance_m != null
                    ? ` · ${s.distance_m < 1000 ? `${s.distance_m} m` : `${(s.distance_m / 1000).toFixed(1)} km`}`
                    : ''}
                </span>
              </span>
              {selected?.uai === s.uai && (
                <Check size={20} className="shrink-0 text-bloque" aria-hidden="true" />
              )}
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">
        Seuls les établissements à moins de 2 km de ta position seront acceptés.
      </p>
      {custom ? (
        <div className="card space-y-3">
          <p className="text-sm font-semibold">Ajouter mon établissement</p>
          <p className="text-xs text-muted">
            L'équipe vérifie et l'ajoute à la carte ; ton signalement suit le même chemin que les
            autres.
          </p>
          <label className="block text-sm">
            Nom de l'établissement
            <input
              className="input mt-1 w-full"
              value={custom.name}
              maxLength={120}
              placeholder="Ex. Lycée agricole Jean-Monnet"
              onChange={(e) => onCustom({ ...custom, name: e.target.value })}
            />
          </label>
          <label className="block text-sm">
            Ville
            <input
              className="input mt-1 w-full"
              value={custom.city}
              maxLength={80}
              onChange={(e) => onCustom({ ...custom, city: e.target.value })}
            />
          </label>
          <button
            type="button"
            className="text-sm text-muted underline"
            onClick={() => onCustom(null)}
          >
            Finalement, il est dans la liste
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="text-sm font-semibold underline"
          onClick={() => onCustom({ name: query.trim(), city: '' })}
        >
          Mon établissement n'est pas dans la liste
        </button>
      )}
    </fieldset>
  )
}

function PrivacyNotice() {
  return (
    <details className="card mt-4" open>
      <summary className="flex cursor-pointer items-center gap-2 font-semibold">
        <ShieldCheck size={18} className="text-bloque" aria-hidden="true" /> Anonyme : ce que je
        garde
      </summary>
      <p className="mt-3 text-sm">
        Pas de compte ni de nom. Ta position est arrondie à 100 m sur ton téléphone et ne sert qu'à
        vérifier que tu es près de l'établissement (jamais affichée). Ta photo est nettoyée de ses
        métadonnées, floutée si besoin avant publication, et l'original est supprimé après
        vérification. Le site n'enregistre pas ton IP (les hébergeurs la voient passer, brièvement).{' '}
        <Link to="/a-propos" className="underline">
          Le détail
        </Link>
      </p>
    </details>
  )
}
