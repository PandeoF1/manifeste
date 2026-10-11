import { Elysia, t } from 'elysia'
import { normalizeDomainInput } from '@manifeste/core'
import { schema, type Database } from '@manifeste/db'
import { asc, eq } from 'drizzle-orm'
import { status } from 'elysia'
import type { Auth } from '../../auth/auth.ts'
import { authPlugin } from '../../auth/plugin.ts'
import { audit } from '../../lib/audit.ts'

const domain = t.Object({
  domain: t.String(),
  label: t.String(),
  origin: t.Union([t.Literal('press'), t.Literal('union')]),
})

/** Press and union domains whose articles are published without moderation. */
export const trustedDomainsModule = (auth: Auth, db: Database) =>
  new Elysia({ name: 'module.trusted-domains', prefix: '/api/staff/trusted-domains' })
    .use(authPlugin(auth))
    .get(
      '/',
      async () =>
        (
          await db.select().from(schema.trustedDomains).orderBy(asc(schema.trustedDomains.domain))
        ).map((d) => ({ ...d, origin: d.origin as 'press' | 'union' })),
      {
        staff: { source: ['manage'] },
        response: { 200: t.Array(domain) },
        detail: { tags: ['staff'], summary: 'Trusted domains' },
      },
    )
    .post(
      '/',
      async ({ body, staff }) => {
        const normalised = normalizeDomainInput(body.domain)
        if (!normalised || normalised.startsWith('www.')) return status(422, 'Invalid domain')
        const [row] = await db
          .insert(schema.trustedDomains)
          .values({ domain: normalised, label: body.label.trim(), origin: body.origin })
          .onConflictDoNothing()
          .returning()
        if (!row) return status(409, 'This domain is already trusted')
        await audit(db, staff, 'trusted-domain.add', normalised, null, body)
        return { ...row, origin: row.origin as 'press' | 'union' }
      },
      {
        staff: { source: ['manage'] },
        body: t.Object({
          domain: t.String({ minLength: 3, maxLength: 253 }),
          label: t.String({ minLength: 1, maxLength: 120 }),
          origin: t.Union([t.Literal('press'), t.Literal('union')]),
        }),
        response: { 200: domain, 409: t.String(), 422: t.String() },
        detail: { tags: ['staff'], summary: 'Trust a domain (its subdomains too)' },
      },
    )
    .delete(
      '/:domain',
      async ({ params, staff }) => {
        const done = await db
          .delete(schema.trustedDomains)
          .where(eq(schema.trustedDomains.domain, params.domain))
          .returning()
        if (done.length === 0) return status(404, 'Unknown domain')
        await audit(db, staff, 'trusted-domain.remove', params.domain, done[0])
        return new Response(null, { status: 204 })
      },
      {
        staff: { source: ['manage'] },
        params: t.Object({ domain: t.String() }),
        response: { 404: t.String() },
        detail: { tags: ['staff'], summary: 'Stop trusting a domain' },
      },
    )
