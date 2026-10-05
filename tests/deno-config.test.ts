import { readFileSync, readdirSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// La CLI Supabase lit le deno.json du dossier de chaque fonction au déploiement :
// chacun doit rester identique à supabase/functions/deno.json.
const root = new URL('../supabase/functions/', import.meta.url)
const reference = JSON.parse(readFileSync(new URL('deno.json', root), 'utf8')) as unknown
const functions = readdirSync(root).filter(
  (name) => !name.startsWith('_') && statSync(new URL(name, root)).isDirectory(),
)

describe('deno.json des Edge Functions', () => {
  it.each(functions)('%s a le même import map que la racine', (name) => {
    const config = JSON.parse(readFileSync(new URL(`${name}/deno.json`, root), 'utf8')) as unknown
    expect(config).toEqual(reference)
  })
})
