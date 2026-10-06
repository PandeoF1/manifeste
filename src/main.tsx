import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { z } from 'zod'
import { queryClient } from './lib/queryClient'
import { persistOptions } from './lib/persist'
import { startTelemetry } from './lib/telemetry'
import { routeTree } from './routeTree.gen'
import './index.css'

// La CSP interdit eval : zod n'essaie pas de compiler ses validateurs (évite l'erreur console).
z.config({ jitless: true })

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

startTelemetry(router)

const root = document.getElementById('root')
if (!root) throw new Error('#root introuvable')

createRoot(root).render(
  <StrictMode>
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <RouterProvider router={router} />
    </PersistQueryClientProvider>
  </StrictMode>,
)
