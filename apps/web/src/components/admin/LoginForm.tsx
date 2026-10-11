import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { authClient } from '@/lib/auth'
import { queryKeys } from '@/lib/queryKeys'

/** Email and password, then the code of the authenticator app when the account has one. */
export function LoginForm() {
  const queryClient = useQueryClient()
  const [step, setStep] = useState<'password' | 'code'>('password')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const done = () => void queryClient.invalidateQueries({ queryKey: queryKeys.session })

  async function onPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setPending(true)
    setError(null)
    const { data, error } = await authClient.signIn.email({
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
    })
    setPending(false)
    if (error) return setError('Identifiants invalides.')
    if (data && 'twoFactorRedirect' in data && data.twoFactorRedirect) return setStep('code')
    done()
  }

  async function onCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const code = String(new FormData(e.currentTarget).get('code') ?? '').replace(/\s/g, '')
    setPending(true)
    setError(null)
    const { error } = await authClient.twoFactor.verifyTotp({ code, trustDevice: false })
    setPending(false)
    if (error) return setError('Code invalide ou expiré.')
    done()
  }

  return (
    <form
      onSubmit={step === 'password' ? onPassword : onCode}
      className="mx-auto mt-12 flex max-w-sm flex-col gap-3 p-4"
    >
      <h1 className="text-xl font-bold">Administration</h1>
      {step === 'password' ? (
        <>
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
        </>
      ) : (
        <label className="flex flex-col gap-1 text-sm">
          Code de l'application d'authentification (6 chiffres)
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            autoFocus
            pattern="[0-9 ]{6,7}"
            className="input tracking-widest"
          />
        </label>
      )}
      {error && (
        <p role="alert" className="text-sm text-bloque">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn-primary">
        {pending ? 'Vérification…' : step === 'password' ? 'Se connecter' : 'Valider'}
      </button>
    </form>
  )
}
