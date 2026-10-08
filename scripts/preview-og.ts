/**
 * Prévisualise localement les aperçus de partage avec des données simulées.
 *   npx tsx scripts/preview-og.ts <dossier de sortie>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

// @vercel/og (build Node) appelle require() dynamiquement : on le fournit en ESM.
;(globalThis as { require?: NodeJS.Require }).require = createRequire(import.meta.url)
// ... et lit ses fichiers wasm relativement à __dirname.
;(globalThis as { __dirname?: string }).__dirname = new URL(
  '../node_modules/@vercel/og/dist',
  import.meta.url,
).pathname

const out = process.argv[2] ?? '.'
process.env.SUPABASE_URL = 'https://demo.supabase.co'
process.env.SUPABASE_ANON_KEY = 'demo'

const statuses = [
  ...Array.from({ length: 193 }, (_, i) => ({
    status: 'bloque',
    department: String(10 + (i % 41)),
  })),
  ...Array.from({ length: 108 }, () => ({ status: 'filtrant', department: '75' })),
]
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input)
  // Node ne sait pas faire fetch(file://) : lecture directe des polices embarquées.
  if (url.startsWith('file:')) return new Response(readFileSync(new URL(url)))
  if (url.includes('school_current_status?uai=eq.0000002B')) {
    return Response.json([
      {
        uai: '0000002B',
        name: 'Lycée Victor Hugo',
        city: 'Besançon',
        department: '25',
        status: 'bloque',
        last_signal_at: '2026-10-05T06:12:00Z',
      },
    ])
  }
  if (url.includes('school_current_status')) return Response.json(statuses)
  if (url.endsWith('/index.html')) {
    return new Response(
      '<html><head><title>x</title><meta name="description" content="d" />\n<meta property="og:title" content="t" /></head><body></body></html>',
    )
  }
  return realFetch(input, init)
}) as typeof fetch

const og = (await import('../api/og')).default
const share = (await import('../api/share')).default
for (const [name, q] of [
  ['og-national', ''],
  ['og-lycee', '?uai=0000002B'],
] as const) {
  const res = await og(new Request(`https://manifeste.example/api/og${q}`))
  writeFileSync(`${out}/${name}.png`, Buffer.from(await res.arrayBuffer()))
}
const html = await (
  await share(new Request('https://manifeste.example/api/share?uai=0000002B'))
).text()
console.log(html.match(/<meta property="og:(title|image|url)"[^>]*>/g)?.join('\n'))
console.log(
  'titres:',
  (html.match(/<title>/g) ?? []).length,
  '| anciennes balises og:title "t":',
  html.includes('content="t"'),
)
