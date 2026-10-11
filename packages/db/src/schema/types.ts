import { customType } from 'drizzle-orm/pg-core'

/**
 * geography(Point, 4326). Written with ST_* SQL and read through ST_X/ST_Y, so the column
 * value itself never crosses the driver (it would arrive as hex EWKB).
 */
export const geographyPoint = customType<{ data: string; driverData: string }>({
  dataType: () => 'geography(Point,4326)',
})
