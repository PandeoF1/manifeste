/**
 * A tiny in-process cache with a time to live, for hot public reads: however many visitors poll
 * an endpoint, the database is queried at most once per `ttlMs`. Concurrent callers share one
 * in-flight load, and a failed load is never cached.
 */
export function memoWithTtl<K, V>(ttlMs: number, load: (key: K) => Promise<V>, now = Date.now) {
  const entries = new Map<string, { at: number; value: Promise<V> }>()
  const keyOf = (key: K) => (typeof key === 'string' ? key : JSON.stringify(key))
  return {
    get(key: K): Promise<V> {
      const id = keyOf(key)
      const hit = entries.get(id)
      if (hit && now() - hit.at < ttlMs) return hit.value
      const value = load(key)
      entries.set(id, { at: now(), value })
      value.catch(() => {
        if (entries.get(id)?.value === value) entries.delete(id)
      })
      return value
    },
    clear: () => entries.clear(),
  }
}
