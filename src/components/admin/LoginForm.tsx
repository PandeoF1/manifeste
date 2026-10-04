import { useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'

export function LoginForm() {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setPending(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
    })
    setPending(false)
    if (error) setError('Identifiants invalides.')
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto mt-12 flex max-w-sm flex-col gap-3 p-4">
      <h1 className="text-xl font-bold">Administration</h1>
      <label className="flex flex-col gap-1 text-sm">
        Email
        <input name="email" type="email" required autoComplete="username" className="input" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Mot de passe
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="input"
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-bloque">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn-primary">
        {pending ? 'Connexion…' : 'Se connecter'}
      </button>
    </form>
  )
}
