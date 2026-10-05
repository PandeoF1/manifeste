import { useEffect, useState } from 'react'
import { useIsRestoring, useQuery } from '@tanstack/react-query'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Download, RefreshCw, WifiOff, X } from 'lucide-react'
import { statusesQuery } from '@/queries/statuses'

const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })

function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

/** "Hors ligne - données de HH:MM" */
export function OfflineBanner() {
  const online = useOnline()
  const restoring = useIsRestoring()
  const { dataUpdatedAt } = useQuery({ ...statusesQuery, enabled: false })
  if (online || restoring) return null
  return (
    <p
      role="status"
      className="flex items-center justify-center gap-2 bg-filtrant px-4 py-2 text-sm font-semibold text-black"
    >
      <WifiOff size={16} aria-hidden="true" />
      Hors ligne
      {dataUpdatedAt > 0 ? ` · données de ${timeFmt.format(new Date(dataUpdatedAt))}` : ''}
    </p>
  )
}

/** Nouvelle version disponible : l'utilisateur recharge quand il veut. */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Vérifie les mises à jour toutes les heures pour les onglets restés ouverts.
      if (registration) window.setInterval(() => void registration.update(), 3_600_000)
    },
  })
  if (!needRefresh) return null
  return (
    <div
      role="status"
      className="glass fixed inset-x-3 bottom-20 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-border p-3 shadow-2xl md:bottom-4"
    >
      <RefreshCw size={18} aria-hidden="true" className="shrink-0" />
      <p className="flex-1 text-sm">Nouvelle version disponible.</p>
      <button
        type="button"
        className="btn-primary min-h-10 px-3 text-sm"
        onClick={() => void updateServiceWorker(true)}
      >
        Recharger
      </button>
      <button
        type="button"
        className="icon-btn size-10"
        aria-label="Plus tard"
        onClick={() => setNeedRefresh(false)}
      >
        <X size={18} />
      </button>
    </div>
  )
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const VISITS_KEY = 'manifest-visits'
const DISMISSED_KEY = 'manifest-install-dismissed'

function safeStorage<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}

/**
 * Invitation à installer l'app : jamais à la première visite, discrète, et plus jamais une fois
 * refusée. (Préférence stockée localement sur l'appareil, rien n'est envoyé.)
 */
export function InstallPrompt() {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [eligible] = useState(() =>
    safeStorage(() => {
      const visits = Number(localStorage.getItem(VISITS_KEY) ?? '0') + 1
      localStorage.setItem(VISITS_KEY, String(visits))
      return visits >= 2 && !localStorage.getItem(DISMISSED_KEY)
    }, false),
  )
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      setEvent(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])
  if (!eligible || !event) return null
  const dismiss = () => {
    safeStorage(() => localStorage.setItem(DISMISSED_KEY, '1'), undefined)
    setEvent(null)
  }
  return (
    <div
      role="dialog"
      aria-label="Installer l'application"
      className="glass fixed inset-x-3 bottom-20 z-40 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-border p-3 shadow-2xl md:bottom-4"
    >
      <img src="/favicon.svg" alt="" width={36} height={36} className="rounded-lg" />
      <p className="flex-1 text-sm">Installe Manifest pour suivre la mobilisation en un geste.</p>
      <button
        type="button"
        className="btn-primary min-h-10 px-3 text-sm"
        onClick={async () => {
          await event.prompt()
          await event.userChoice
          dismiss()
        }}
      >
        <Download size={16} aria-hidden="true" /> Installer
      </button>
      <button type="button" className="icon-btn size-10" aria-label="Non merci" onClick={dismiss}>
        <X size={18} />
      </button>
    </div>
  )
}
