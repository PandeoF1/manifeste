import { useState, type FormEvent } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { z } from 'zod'
import { authClient } from '@/lib/auth'

export const Route = createFileRoute('/admin_/mot-de-passe')({
  validateSearch: z.object({ token: z.string().optional(), error: z.string().optional() }),
  component: PasswordPage,
  head: () => ({ meta: [{ name: 'robots', content: 'noindex' }] }),
})

/** Where a one-time link from an invitation lands: choose a password. */
function PasswordPage() {
  const { token, error: linkError } = Route.useSearch()
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const password = String(form.get('password') ?? '')
    if (password.length < 12) return setError('12 caractères au minimum.')
    if (password !== form.get('confirm')) return setError('Les deux mots de passe diffèrent.')
    setPending(true)
    setError(null)
    const { error } = await authClient.resetPassword({
      newPassword: password,
      ...(token && { token }),
    })
    setPending(false)
    if (error) return setError('Ce lien a expiré ou a déjà servi. Demande-en un nouveau.')
    setDone(true)
  }

  if (!token || linkError)
    return (
      <main className="mx-auto mt-12 max-w-sm p-4">
        <p role="alert">
          Ce lien n'est pas valide ou a expiré. Demande-en un nouveau à un administrateur.
        </p>
      </main>
    )
  if (done)
    return (
      <main className="mx-auto mt-12 max-w-sm space-y-3 p-4">
        <p>Mot de passe enregistré.</p>
        <Link to="/admin" search={{ tab: 'pipeline' }} className="btn-primary inline-block">
          Se connecter
        </Link>
      </main>
    )
  return (
    <form onSubmit={onSubmit} className="mx-auto mt-12 flex max-w-sm flex-col gap-3 p-4">
      <h1 className="text-xl font-bold">Choisis ton mot de passe</h1>
      <label className="flex flex-col gap-1 text-sm">
        Mot de passe (12 caractères minimum)
        <input
          name="password"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          className="input"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Confirmation
        <input
          name="confirm"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          className="input"
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-bloque">
          {error}
        </p>
      )}
      <button className="btn-primary" disabled={pending}>
        Enregistrer
      </button>
    </form>
  )
}
