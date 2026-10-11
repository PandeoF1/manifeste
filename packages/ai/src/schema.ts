/**
 * Output schemas are TypeBox schemas, so one definition gives the JSON Schema sent to the
 * provider, the TypeScript type and the validator. These helpers keep them in the subset every
 * provider accepts, and translate to Gemini's OpenAPI dialect.
 */
import { Kind, type TSchema, Type as t, TypeRegistry } from '@sinclair/typebox'

// A string enum is `{ type: 'string', enum }` for providers (unlike anyOf of consts). TypeBox
// cannot validate an Unsafe schema, so it gets a kind of its own, with a check.
TypeRegistry.Set<{ enum: string[] }>(
  'AiEnum',
  (schema, value) => typeof value === 'string' && schema.enum.includes(value),
)

export const Enum = <const T extends readonly string[]>(values: T, description?: string) =>
  t.Unsafe<T[number]>({
    [Kind]: 'AiEnum',
    type: 'string',
    enum: [...values],
    ...(description && { description }),
  })

/** A value or null, as `anyOf [X, null]`; every adapter understands it. */
export const Nullable = <T extends TSchema>(schema: T) => t.Union([schema, t.Null()])

/** Object with every property required and no extras: what strict structured outputs demand. */
export const Strict = <T extends Record<string, TSchema>>(properties: T) =>
  t.Object(properties, { additionalProperties: false })

type Json = Record<string, unknown>

/** Gemini's `responseSchema` is an OpenAPI subset: upper-case types, `nullable`, no anyOf, no extras. */
export function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema)
  if (schema === null || typeof schema !== 'object') return schema
  const node = schema as Json
  const anyOf = node.anyOf
  if (Array.isArray(anyOf)) {
    const nonNull = anyOf.filter((s) => (s as Json).type !== 'null')
    if (nonNull.length === 1 && nonNull.length !== anyOf.length)
      return { ...(toGeminiSchema(nonNull[0]) as Json), nullable: true }
  }
  const out: Json = {}
  for (const [key, value] of Object.entries(node)) {
    if (key === 'additionalProperties' || key === '$schema' || key === '$id') continue
    if (key === 'type' && typeof value === 'string') out[key] = value.toUpperCase()
    else if (key === 'properties' && value && typeof value === 'object')
      out[key] = Object.fromEntries(
        Object.entries(value as Json).map(([k, v]) => [k, toGeminiSchema(v)]),
      )
    else out[key] = toGeminiSchema(value)
  }
  if (out.type === 'OBJECT' && node.properties && !out.propertyOrdering)
    out.propertyOrdering = Object.keys(node.properties as Json)
  return out
}

/** A TypeBox schema as plain JSON (drops the symbol keys TypeBox adds). */
export const toJsonSchema = (schema: unknown): unknown => JSON.parse(JSON.stringify(schema))
