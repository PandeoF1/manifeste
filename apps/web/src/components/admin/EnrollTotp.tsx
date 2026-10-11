import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { authClient } from '@/lib/auth'
import { queryKeys } from '@/lib/queryKeys'
import { useSignOut } from '@/queries/admin'

/**
 * An admin must have a second factor before the admin opens. Three steps: confirm the password,
 * add the secret to an authenticator app, prove it works with a first code. The recovery codes
 * are shown once.
 */
export function EnrollTotp() {
  const queryClient = useQueryClient()
  const signOut = useSignOut()
  const [setup, setSetup] = useState<{ uri: string; secret: string; backupCodes: string[] } | null>(
    null,
  )
  const [verified, setVerified] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function start(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const password = String(new FormData(e.currentTarget).get('password') ?? '')
    const { data, error } = await authClient.twoFactor.enable({ password })
    setPending(false)
    if (error || !data || !('totpURI' in data)) return setError('Mot de passe incorrect.')
    const secret = new URL(data.totpURI).searchParams.get('secret') ?? ''
    setSetup({ uri: data.totpURI, secret, backupCodes: data.backupCodes })
  }

  async function verify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const code = String(new FormData(e.currentTarget).get('code') ?? '').replace(/\s/g, '')
    const { error } = await authClient.twoFactor.verifyTotp({ code })
    setPending(false)
    if (error) return setError("Code invalide. Vérifie l'heure de ton téléphone.")
    setVerified(true)
  }

  return (
    <main className="mx-auto mt-10 w-full max-w-md space-y-4 p-4">
      <h1 className="text-xl font-bold">Authentification à deux facteurs</h1>
      <p className="text-sm text-muted">
        L'administration exige un second facteur. Tu en as besoin une seule fois pour l'activer.
      </p>
      {!setup && (
        <form onSubmit={start} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Confirme ton mot de passe
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="input"
            />
          </label>
          <button className="btn-primary" disabled={pending}>
            Commencer
          </button>
        </form>
      )}
      {setup && !verified && (
        <form onSubmit={verify} className="flex flex-col gap-3">
          <p className="text-sm">
            Ajoute ce compte dans ton application d'authentification (« ouvrir » ou saisie du
            secret), puis entre le code à 6 chiffres.
          </p>
          <a href={setup.uri} className="btn-secondary w-fit">
            Ouvrir dans l'application
          </a>
          <code className="card block break-all p-2 text-sm select-all">{setup.secret}</code>
          <label className="flex flex-col gap-1 text-sm">
            Code
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              className="input tracking-widest"
            />
          </label>
          <button className="btn-primary" disabled={pending}>
            Vérifier
          </button>
        </form>
      )}
      {setup && verified && (
        <div className="space-y-3">
          <p className="text-sm font-semibold">
            C'est activé. Garde ces codes de secours, ils ne seront plus affichés.
          </p>
          <ul className="card grid grid-cols-2 gap-1 p-3 font-mono text-sm">
            {setup.backupCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <button
            className="btn-primary"
            onClick={() => void queryClient.invalidateQueries({ queryKey: queryKeys.session })}
          >
            J'ai noté mes codes, continuer
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-bloque">
          {error}
        </p>
      )}
      <button type="button" className="text-sm text-muted underline" onClick={() => void signOut()}>
        Se déconnecter
      </button>
    </main>
  )
}
