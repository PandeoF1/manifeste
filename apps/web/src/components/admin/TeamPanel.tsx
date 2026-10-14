import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, KeyRound, Trash2 } from 'lucide-react'
import { authClient } from '@/lib/auth'
import { queryKeys } from '@/lib/queryKeys'
import { inviteMember, membersQuery, newPasswordLink } from '@/queries/admin'

const ROLE_LABEL = { admin: 'Administrateur', moderator: 'Modérateur' } as const
const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' })

/** Staff accounts: invite, give a new password link, change role, suspend, delete. No public accounts exist. */
export function TeamPanel({ selfId }: { selfId: string }) {
  const queryClient = useQueryClient()
  const members = useQuery(membersQuery)
  const [link, setLink] = useState<{ email: string; url: string; hours: number } | null>(null)
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: [...queryKeys.admin.all, 'members'] })

  const invite = useMutation({
    mutationFn: inviteMember,
    onSuccess: (r, v) => {
      setLink({ email: v.email, url: r.passwordLink, hours: r.expiresInHours })
      refresh()
    },
  })
  const relink = useMutation({
    mutationFn: ({ id }: { id: string; email: string }) => newPasswordLink(id),
    onSuccess: (r, v) => setLink({ email: v.email, url: r.passwordLink, hours: r.expiresInHours }),
  })
  const act = useMutation({
    mutationFn: async (fn: () => Promise<{ error: { message?: string } | null }>) => {
      const { error } = await fn()
      if (error) throw new Error(error.message ?? 'Échec')
    },
    onSuccess: refresh,
  })

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const d = new FormData(form)
    invite.mutate(
      {
        email: String(d.get('email')),
        name: String(d.get('name')),
        role: d.get('role') === 'admin' ? 'admin' : 'moderator',
      },
      { onSuccess: () => form.reset() },
    )
  }
  const error = invite.error ?? relink.error ?? act.error

  return (
    <div className="space-y-5">
      <form onSubmit={onSubmit} className="card grid gap-3 p-4 md:grid-cols-[1fr_1fr_auto_auto]">
        <input
          name="email"
          type="email"
          required
          placeholder="email"
          className="input"
          aria-label="Email"
        />
        <input name="name" required placeholder="nom" className="input" aria-label="Nom" />
        <select name="role" className="input" aria-label="Rôle" defaultValue="moderator">
          <option value="moderator">Modérateur</option>
          <option value="admin">Administrateur</option>
        </select>
        <button className="btn-primary" disabled={invite.isPending}>
          Inviter
        </button>
      </form>
      {link && (
        <div className="card space-y-1 p-3 text-sm" role="status">
          <p className="font-semibold">
            Lien pour {link.email}, valable {link.hours} h, à transmettre en privé :
          </p>
          <code className="block break-all select-all">{link.url}</code>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-bloque">
          Échec : {error.message}
        </p>
      )}
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
        {members.data?.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
            <span className="min-w-0 flex-1">
              <span className="font-medium">{m.name}</span>{' '}
              <span className="text-muted">· {m.email}</span>
              <span className="block text-xs text-muted">
                {ROLE_LABEL[m.role as keyof typeof ROLE_LABEL] ?? m.role} · depuis{' '}
                {dateFmt.format(m.createdAt)} · 2FA {m.twoFactorEnabled ? 'activée' : 'non activée'}
                {m.banned && ' · suspendu'}
              </span>
            </span>
            <button
              type="button"
              className="icon-btn"
              aria-label="Nouveau lien de mot de passe"
              title="Nouveau lien de mot de passe"
              onClick={() => relink.mutate({ id: m.id, email: m.email })}
            >
              <KeyRound size={18} />
            </button>
            {m.id !== selfId && (
              <>
                <select
                  className="input w-auto"
                  aria-label={`Rôle de ${m.name}`}
                  value={m.role}
                  onChange={(e) =>
                    act.mutate(() =>
                      authClient.admin.setRole({ userId: m.id, role: e.target.value as 'admin' }),
                    )
                  }
                >
                  <option value="moderator">Modérateur</option>
                  <option value="admin">Administrateur</option>
                </select>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={m.banned ? 'Réactiver' : 'Suspendre'}
                  title={m.banned ? 'Réactiver' : 'Suspendre'}
                  onClick={() =>
                    act.mutate(() =>
                      m.banned
                        ? authClient.admin.unbanUser({ userId: m.id })
                        : authClient.admin.banUser({ userId: m.id }),
                    )
                  }
                >
                  <Ban size={18} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Supprimer le compte"
                  onClick={() => {
                    if (window.confirm(`Supprimer le compte de ${m.name} ?`))
                      act.mutate(() => authClient.admin.removeUser({ userId: m.id }))
                  }}
                >
                  <Trash2 size={18} />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
