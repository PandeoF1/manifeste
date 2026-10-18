/**
 * A real server for the browser tests: the built SPA, a throwaway database (cloned from the
 * migrated template), a few schools and reports, and a moderator account.
 * Started by Playwright (`webServer`), stopped with it.
 */
import { schema } from '@manifeste/db'
import { eq } from 'drizzle-orm'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { StaffService } from '../apps/server/src/modules/staff/service.ts'
import { startTestServer, STAFF_PASSWORD } from '../apps/server/test/helpers.ts'
import { addReport, addSchool } from '../apps/server/test/seed.ts'

const PORT = Number(process.env.E2E_PORT ?? 4310)

const s = await startTestServer({
  WEB_DIST: resolve(import.meta.dir, '../apps/web/dist'),
  PUBLIC_URL: `http://127.0.0.1:${PORT}`,
})
const db = s.ctx.db

const lille = await addSchool(db, {
  name: 'Lycée Pasteur',
  city: 'Lille',
  department: '59',
  academy: 'Lille',
  lat: 50.63,
  lng: 3.06,
})
const marseille = await addSchool(db, {
  name: 'Lycée Curie',
  city: 'Marseille',
  department: '13',
  academy: 'Aix-Marseille',
  lat: 43.29,
  lng: 5.37,
})
await addSchool(db, {
  name: 'Université de Nanterre',
  city: 'Nanterre',
  department: '92',
  academy: 'Versailles',
  level: 'higher',
  lat: 48.9,
  lng: 2.21,
})
// Many route proposals: the admin tab must stay usable (one map at a time, a page at a time).
await db.insert(schema.routeProposals).values(
  Array.from({ length: 40 }, (_, i) => ({
    url: `https://press.example/cortege-${i}`,
    domain: 'press.example',
    city: 'Lille',
    citycode: '59350',
    day: '2026-10-13',
    timing: 'announced',
    title: `Cortège numéro ${i}`,
    places: [
      {
        name: 'Place A',
        quote: '… Place A …',
        lng: 3.07,
        lat: 50.63,
        status: 'ok' as const,
        label: null,
      },
      {
        name: 'Rue B',
        quote: '… Rue B …',
        lng: 3.06,
        lat: 50.636,
        status: 'ok' as const,
        label: null,
      },
    ],
    line: [
      [3.07, 50.63],
      [3.06, 50.636],
    ] as Array<[number, number]>,
    lineKm: 1.2,
    warnings: i % 3 === 0 ? ['Lieu incertain : Rue B (à vérifier sur la carte)'] : [],
    groupKey: `59350|2026-10-${String(10 + (i % 20)).padStart(2, '0')}`,
  })),
)
await addReport(db, {
  schoolUai: lille,
  status: 'blocked',
  hoursAgo: 1,
  origin: 'press',
  sourceDomain: 'journal.example',
})
await addReport(db, {
  schoolUai: marseille,
  status: 'filtering',
  hoursAgo: 2,
  origin: 'union',
  sourceDomain: 'syndicat.example',
})
await addReport(db, {
  schoolUai: marseille,
  status: 'blocked',
  hoursAgo: 1,
  origin: 'on_site',
  moderation: 'pending',
})
await db
  .insert(schema.settings)
  .values({ key: 'movement_start', value: '2026-09-14' })
  .onConflictDoNothing()

// A moderator who can sign in with a known password (no second factor for moderators), created the
// way the product does: an invitation, then the one-time link.
const origin = `http://127.0.0.1:${PORT}`
const invitation = await new StaffService(db, s.ctx.auth, origin).invite({
  email: 'moderator@example.org',
  name: 'Moderator',
  role: 'moderator',
})
if (!('passwordLink' in invitation)) throw new Error('invitation failed')
const token = new URL(invitation.passwordLink).pathname.split('/').at(-1)
const reset = await s.app.handle(
  new Request(`${origin}/api/auth/reset-password`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ token, newPassword: STAFF_PASSWORD }),
  }),
)
if (reset.status !== 200) throw new Error(`password reset failed: ${reset.status}`)
// An admin whose second factor is "enabled" (the rule only looks at the flag), signed in here: the
// browser tests borrow its session cookie instead of going through TOTP.
const adminInvite = await new StaffService(db, s.ctx.auth, origin).invite({
  email: 'admin@example.org',
  name: 'Admin',
  role: 'admin',
})
if (!('passwordLink' in adminInvite)) throw new Error('invitation failed')
await s.app.handle(
  new Request(`${origin}/api/auth/reset-password`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({
      token: new URL(adminInvite.passwordLink).pathname.split('/').at(-1),
      newPassword: STAFF_PASSWORD,
    }),
  }),
)
const signIn = await s.app.handle(
  new Request(`${origin}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.org', password: STAFF_PASSWORD }),
  }),
)
if (signIn.status !== 200) throw new Error(`admin sign-in failed: ${signIn.status}`)
await db
  .update(schema.user)
  .set({ twoFactorEnabled: true })
  .where(eq(schema.user.email, 'admin@example.org'))
const cookies = signIn.headers.getSetCookie().map((c) => {
  const [pair = ''] = c.split(';')
  const at = pair.indexOf('=')
  return { name: pair.slice(0, at), value: pair.slice(at + 1), url: origin }
})
await mkdir(resolve(import.meta.dir, '.auth'), { recursive: true })
await writeFile(resolve(import.meta.dir, '.auth/admin.json'), JSON.stringify(cookies))
// Some pipeline activity for the admin to show.
await db.insert(schema.sources).values({
  kind: 'rss',
  identifier: 'https://journal.example/feed',
  label: 'Journal',
  origin: 'press',
})
await db.insert(schema.pipelineEvents).values([
  { stage: 'discover', outcome: 'ok', detail: { fetched: 12, new: 3 } },
  { stage: 'read', outcome: 'ok', durationMs: 340, detail: { strategy: 'article', chars: 2400 } },
  {
    stage: 'extract',
    outcome: 'extracted',
    durationMs: 1800,
    detail: { facts: 1, model: 'gemini-3.5-flash-lite' },
  },
  { stage: 'store', outcome: 'reported', detail: { school: 'Lycée Pasteur' } },
])

console.log(
  JSON.stringify({
    moderator: { email: 'moderator@example.org', password: STAFF_PASSWORD },
    lille,
  }),
)

s.app.listen({ port: PORT, hostname: '127.0.0.1' })
console.log(`e2e server on http://127.0.0.1:${PORT}`)
await s.ctx.bus.start()
process.on('SIGTERM', () => void s.close().then(() => process.exit(0)))
process.on('SIGINT', () => void s.close().then(() => process.exit(0)))
