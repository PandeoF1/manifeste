import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import type { PersistQueryClientOptions } from '@tanstack/react-query-persist-client'
import { del, get, set } from 'idb-keyval'

const KEY = 'manifest-cache-v1'

/** Cache of public data in IndexedDB: last known state shown offline. */
export const persistOptions: Omit<PersistQueryClientOptions, 'queryClient'> = {
  persister: createAsyncStoragePersister({
    storage: {
      getItem: async (k) => (await get<string>(k)) ?? null,
      setItem: (k, v) => set(k, v),
      removeItem: (k) => del(k),
    },
    key: KEY,
    throttleTime: 2000,
  }),
  maxAge: 24 * 3_600_000,
  buster: '1',
  dehydrateOptions: {
    // Public data only (never the admin nor the session).
    shouldDehydrateQuery: (q) =>
      q.state.status === 'success' && (q.queryKey[0] === 'statuses' || q.queryKey[0] === 'school'),
  },
}
