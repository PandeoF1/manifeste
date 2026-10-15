/**
 * Every AI call pays for its instructions again (~600 tokens for a media call, ~1,600 for an
 * extraction), whatever the number of articles it carries. Sweeps run after every read, which
 * brings one or two articles: sent alone, the instructions cost more than the articles.
 *
 * So a sweep waits for a full batch. Nothing is dropped and nothing waits for ever: once the
 * oldest waiting item has waited `maxWaitMs`, everything goes, full batch or not.
 */
export function takeBatches<T extends { waitingSince: Date }>(
  items: readonly T[],
  size: number,
  maxWaitMs: number,
  now: Date,
): T[] {
  if (items.length === 0) return []
  if (maxWaitMs <= 0 || size <= 1) return [...items]
  const oldest = Math.min(...items.map((i) => i.waitingSince.getTime()))
  if (now.getTime() - oldest >= maxWaitMs) return [...items]
  return items.slice(0, items.length - (items.length % size))
}
