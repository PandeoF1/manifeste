import { clear as clearIdb } from 'idb-keyval'

/**
 * Last-resort recovery: forget everything this browser stored for the site (query cache in
 * IndexedDB, service workers and their caches, local and session storage). Never throws: each
 * step is attempted on its own, because a broken browser state is exactly when this is needed.
 */
export async function resetLocalData(): Promise<void> {
  const steps: Array<() => Promise<unknown> | unknown> = [
    () => clearIdb(),
    async () => {
      const registrations = (await navigator.serviceWorker?.getRegistrations()) ?? []
      await Promise.all(registrations.map((r) => r.unregister()))
    },
    async () => {
      const keys = (await globalThis.caches?.keys()) ?? []
      await Promise.all(keys.map((k) => caches.delete(k)))
    },
    () => localStorage.clear(),
    () => sessionStorage.clear(),
  ]
  for (const step of steps) {
    try {
      await step()
    } catch {
      // keep going
    }
  }
}

/** `/?reset` (or `?reset=1`) clears local data before the app starts: works even if React crashes. */
export const wantsReset = (search: string): boolean => new URLSearchParams(search).has('reset')

/** The same address without the `reset` parameter. */
export function withoutReset(href: string): string {
  const url = new URL(href)
  url.searchParams.delete('reset')
  return url.pathname + url.search + url.hash
}
