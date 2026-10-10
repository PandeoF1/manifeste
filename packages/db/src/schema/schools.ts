import { sql } from 'drizzle-orm'
import { check, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { schoolLevel } from './enums.ts'
import { geographyPoint } from './types.ts'

/** National directory of lycées and higher-education sites (imported from open data). */
export const schools = pgTable(
  'schools',
  {
    uai: text().primaryKey(),
    name: text().notNull(),
    city: text().notNull(),
    postcode: text(),
    department: text(),
    academy: text(),
    /** Type as published by the directory ("Lycée polyvalent", "Université"…). */
    kind: text(),
    level: schoolLevel().notNull().default('secondary'),
    location: geographyPoint(),
    /** Other names the school is known by ("fac de Tolbiac"), used by matching. */
    aliases: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    nameNorm: text().generatedAlwaysAs(sql`normalize_text(name)`),
    cityNorm: text().generatedAlwaysAs(sql`normalize_text(city)`),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('schools_uai_format', sql`${t.uai} ~ '^[0-9]{7}[A-Z]$'`),
    index('schools_name_trgm').using('gin', sql`${t.nameNorm} gin_trgm_ops`),
    index('schools_city_trgm').using('gin', sql`${t.cityNorm} gin_trgm_ops`),
    index('schools_location').using('gist', t.location),
    index().on(t.department),
    index().on(t.level),
  ],
)
