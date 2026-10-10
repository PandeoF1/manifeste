import { useEffect, useRef, useState } from 'react'
import { useIsRestoring, useQuery } from '@tanstack/react-query'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Download, RefreshCw, WifiOff, X } from 'lucide-react'
import { statusesQuery } from '@/queries/statuses'

/**
 * Bottom banners: above the floating "Report" button on phones, at the bottom on desktop.
 */
const NOTICE_CLASS =
  'fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-border p-3 shadow-2xl md:bottom-4'

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

/** New version available: the user reloads when they want. */
export function UpdatePrompt() {
  const registrationRef = useRef<ServiceWorkerRegistration | undefined>(undefined)
  const [updating, setUpdating] = useState(false)
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return
      registrationRef.current = registration
      // Tabs left open and app reopened from the home screen: check again.
      const check = () => {
        if (!registration.installing && navigator.onLine) void registration.update()
      }
      window.setInterval(check, 30 * 60_000)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
    },
  })

  async function reload() {
    setUpdating(true)
    // workbox only reloads the page for an update found by this tab at load time:
    // found later (periodic check, another tab), the new version would activate
    // without the page reloading. So we reload ourselves as soon as it takes control.
    let done = false
    const go = () => {
      if (done) return
      done = true
      window.location.reload()
    }
    navigator.serviceWorker?.addEventListener('controllerchange', go, { once: true })
    registrationRef.current?.waiting?.postMessage({ type: 'SKIP_WAITING' })
    await updateServiceWorker(true)
    // Safety net: reload even if the event does not come.
    window.setTimeout(go, 3000)
  }

  if (!needRefresh) return null
  return (
    <div role="status" className={`glass ${NOTICE_CLASS} z-50`}>
      <RefreshCw
        size={18}
        aria-hidden="true"
        className={`shrink-0 ${updating ? 'animate-spin' : ''}`}
      />
      <p className="flex-1 text-sm">{updating ? 'Mise à jour…' : 'Nouvelle version disponible.'}</p>
      <button
        type="button"
        className="btn-primary min-h-10 px-3 text-sm"
        disabled={updating}
        onClick={() => void reload()}
      >
        Recharger
      </button>
      {!updating && (
        <button
          type="button"
          className="icon-btn size-10"
          aria-label="Plus tard"
          onClick={() => setNeedRefresh(false)}
        >
          <X size={18} />
        </button>
      )}
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
 * Invitation to install the app: never on the first visit, discreet, and never again once
 * declined. (Preference stored locally on the device, nothing is sent.)
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
      className={`glass ${NOTICE_CLASS} z-40`}
    >
      <img src="/favicon.svg" alt="" width={36} height={36} className="rounded-lg" />
      <p className="flex-1 text-sm">Installe Manifeste pour suivre la mobilisation en un geste.</p>
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
