import {
  readSettings,
  SETTINGS,
  type Settings,
  type SettingKey,
  type SettingValue,
} from '@manifeste/core'
import { schema, type Database } from '@manifeste/db'
import { eq, sql } from 'drizzle-orm'
import { memoWithTtl } from '../../lib/memo.ts'

/** Settings are read on almost every public request: cache them for a few seconds. */
const TTL_MS = 5_000

export class SettingsService {
  private readonly cache = memoWithTtl(TTL_MS, () => this.load())

  constructor(private readonly db: Database) {}

  private async load(): Promise<Settings> {
    const stored = await this.db.select().from(schema.settings)
    return readSettings(stored)
  }

  all(): Promise<Settings> {
    return this.cache.get('all')
  }

  /** Writes one validated setting (the caller has checked permissions) and drops the cache. */
  async set<K extends SettingKey>(key: K, value: SettingValue<K>, userId: string | null) {
    await this.db
      .insert(schema.settings)
      .values({ key, value, updatedBy: userId })
      .onConflictDoUpdate({
        target: schema.settings.key,
        set: { value, updatedBy: userId, updatedAt: sql`now()` },
      })
    this.cache.clear()
  }

  async remove(key: SettingKey) {
    await this.db.delete(schema.settings).where(eq(schema.settings.key, key))
    this.cache.clear()
  }

  /** Default values, for the admin UI. */
  static defaults() {
    return Object.fromEntries(Object.entries(SETTINGS).map(([k, v]) => [k, v.default]))
  }
}
