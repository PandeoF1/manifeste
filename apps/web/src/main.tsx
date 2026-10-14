import './lib/zodConfig'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { queryClient } from './lib/queryClient'
import { persistOptions } from './lib/persist'
import { startTelemetry } from './lib/telemetry'
import { routeTree } from './routeTree.gen'
import { CrashScreen } from '@/components/layout/CrashScreen'
import { resetLocalData, wantsReset, withoutReset } from './lib/resetLocal'
import './index.css'

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
  defaultErrorComponent: CrashScreen,
  scrollRestoration: true,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

startTelemetry(router)

/** `/?reset`: clear local data before anything else starts, then reload without the parameter. */
async function start() {
  if (wantsReset(window.location.search)) {
    await resetLocalData()
    window.location.replace(withoutReset(window.location.href))
    return
  }
  mount()
}

const root = document.getElementById('root')
if (!root) throw new Error('#root introuvable')

function mount() {
  if (!root) return
  createRoot(root).render(
    <StrictMode>
      <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
        <RouterProvider router={router} />
      </PersistQueryClientProvider>
    </StrictMode>,
  )
}

void start()
