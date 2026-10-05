import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import type { PersistQueryClientOptions } from '@tanstack/react-query-persist-client'
import { del, get, set } from 'idb-keyval'

const KEY = 'manifest-cache-v1'

/** Cache des données publiques dans IndexedDB : dernier état connu affiché hors ligne. */
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
    // Uniquement les données publiques (jamais l'admin ni la session).
    shouldDehydrateQuery: (q) =>
      q.state.status === 'success' && (q.queryKey[0] === 'statuses' || q.queryKey[0] === 'school'),
  },
}
