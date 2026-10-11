import { t } from 'elysia'

/**
 * An optional string enum for a query or a body. `t.Optional(t.UnionEnum([...]))` is a trap: Elysia
 * fills a missing value with the first entry, so "no filter" silently becomes "filter on the first
 * value". A union of literals has no default.
 */
export const optionalEnum = <const T extends readonly string[]>(values: T) =>
  t.Optional(
    t.Union(
      values.map((v) => t.Literal(v)) as unknown as [ReturnType<typeof t.Literal<T[number]>>],
    ),
  )
