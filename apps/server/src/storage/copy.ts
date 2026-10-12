/**
 * Copies photos from one store to another (the volume of a running deployment into a bucket, or
 * back). Safe to repeat: what the target already holds is left alone. A dry run reads only.
 */
import { AREAS, type Area, type BlobStore } from './blob-store.ts'

export interface CopyResult {
  area: Area
  found: number
  copied: number
  alreadyThere: number
  failed: Array<{ key: string; error: string }>
  bytes: number
}

export async function copyBlobs(
  from: BlobStore,
  to: BlobStore,
  options: { areas?: readonly Area[]; dryRun?: boolean } = {},
): Promise<CopyResult[]> {
  const results: CopyResult[] = []
  for (const area of options.areas ?? AREAS) {
    const r: CopyResult = { area, found: 0, copied: 0, alreadyThere: 0, failed: [], bytes: 0 }
    const there = new Set((await to.list(area)).map((b) => b.key))
    for (const { key } of await from.list(area)) {
      r.found++
      if (there.has(key)) {
        r.alreadyThere++
        continue
      }
      try {
        const bytes = await from.get(key)
        if (!bytes) continue // deleted meanwhile (the sweeper): nothing to carry
        if (!options.dryRun) await to.put(key, bytes)
        r.copied++
        r.bytes += bytes.length
      } catch (e) {
        r.failed.push({ key, error: e instanceof Error ? e.message : String(e) })
      }
    }
    results.push(r)
  }
  return results
}
