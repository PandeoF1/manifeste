/**
 * A tiny in-process cache with a time to live, for hot public reads: however many visitors poll
 * an endpoint, the database is queried at most once per `ttlMs`. Concurrent callers share one
 * in-flight load, and a failed load is never cached.
 */
export function memoWithTtl<K, V>(
  ttlMs: number,
  load: (key: K) => Promise<V>,
  now = Date.now,
  /** Keys kept at once; the oldest go first. Bounds memory when the keys come from outside. */
  maxEntries = 1000,
) {
  const entries = new Map<string, { at: number; value: Promise<V> }>()
  const keyOf = (key: K) => (typeof key === 'string' ? key : JSON.stringify(key))
  return {
    get(key: K): Promise<V> {
      const id = keyOf(key)
      const hit = entries.get(id)
      if (hit && now() - hit.at < ttlMs) return hit.value
      const value = load(key)
      entries.delete(id)
      entries.set(id, { at: now(), value })
      // A Map iterates in insertion order: the first key is the oldest.
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value as string)
      value.catch(() => {
        if (entries.get(id)?.value === value) entries.delete(id)
      })
      return value
    },
    clear: () => entries.clear(),
  }
}
