/**
 * The routes stage, beside the main flow: press articles that were read are searched for marches
 * with a described route. Findings are PROPOSALS (route_proposals): nothing reaches the public map
 * until a person approves one in the admin. It has its own sweep, AI-call cap and admin switch
 * (`route_detection`, off by default), and it reads each article once (route_scans).
 *
 * Cost control: a cheap text filter decides which articles are worth an AI call at all.
 */
import { AiError, detectRoutes, ROUTES_PROMPT_VERSION, type DetectedMarch } from '@manifeste/ai'
import { extractDomain } from '@manifeste/core'
import { schema } from '@manifeste/db'
import { and, desc, eq, gte, inArray, notExists, sql } from 'drizzle-orm'
import type { IngestDeps } from './deps.ts'
import { inSpan } from './events.ts'
import { chunk } from './http.ts'
import { fold, Geocoder } from './geocode.ts'
import { routeWarnings, walkingRoute } from './osrm.ts'

type ProposalPlace = (typeof schema.routeProposals.$inferInsert)['places'][number]

export interface RoutesSweepResult {
  scanned: number
  skipped: number
  calls: number
  proposals: number
  more: boolean
}

const ROUTE_WORDS =
  /parcours|cort[èe]ge|d[ée]fil|itin[ée]raire|partira|d[ée]part|rassemblement|manifest|marche/i
const PLACE_WORDS =
  /\b(place|rue|boulevard|bd|avenue|quai|pont|cours|esplanade|gare|pr[ée]fecture|mairie|universit[ée]|rectorat|rond-point|parvis)\b/i
const MIN_TEXT = 400

/** Worth an AI call: long enough, talks about a march and names kinds of places. */
export const worthReading = (text: string): boolean =>
  text.length >= MIN_TEXT && ROUTE_WORDS.test(text) && PLACE_WORDS.test(text)

const parisDay = (d: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(d)

export const groupKeyOf = (citycode: string | null, city: string, day: string | null): string =>
  `${citycode ?? fold(city).replace(/ /g, '-')}|${day ?? 'sans-date'}`

export async function routesSweep(deps: IngestDeps): Promise<RoutesSweepResult> {
  const { db, config, ai } = deps
  const result: RoutesSweepResult = { scanned: 0, skipped: 0, calls: 0, proposals: 0, more: false }
  if (!config.routeDetection || !ai.config.enabled) return result
  if (!(await deps.settings.all()).route_detection) return result

  const since = new Date(deps.now().getTime() - config.contentRetentionDays * 86_400_000)
  const limit = config.routesBatchSize * config.maxRoutesCalls
  const rows = await db
    .select({
      url: schema.ingestItems.url,
      publishedAt: schema.ingestItems.publishedAt,
      publisherDomain: schema.ingestItems.publisherDomain,
      text: schema.itemContents.text,
      title: schema.itemContents.title,
    })
    .from(schema.ingestItems)
    .innerJoin(schema.sources, eq(schema.sources.id, schema.ingestItems.sourceId))
    .innerJoin(schema.itemContents, eq(schema.itemContents.itemId, schema.ingestItems.id))
    .where(
      and(
        eq(schema.sources.kind, 'rss'),
        inArray(schema.ingestItems.state, ['read', 'extracted', 'done', 'no_event']),
        gte(schema.ingestItems.discoveredAt, since),
        sql`${schema.ingestItems.url} not like 'https://news.google.com/%'`,
        notExists(
          db
            .select({ one: sql`1` })
            .from(schema.routeScans)
            .where(eq(schema.routeScans.url, schema.ingestItems.url)),
        ),
      ),
    )
    .orderBy(desc(schema.ingestItems.publishedAt))
    .limit(limit * 4 + 1)

  // The same URL can come from several sources: once is enough.
  const seen = new Set<string>()
  const unique = rows.filter((r) => (seen.has(r.url) ? false : (seen.add(r.url), true)))
  const worth = unique.filter((r) => worthReading(r.text))
  const skip = unique.filter((r) => !worthReading(r.text))
  if (skip.length > 0) {
    await db
      .insert(schema.routeScans)
      .values(skip.map((r) => ({ url: r.url, found: 0 })))
      .onConflictDoNothing()
    result.skipped = skip.length
  }
  const todo = worth.slice(0, limit)
  result.more = worth.length > limit
  if (todo.length === 0) return { ...result, more: false }

  const chain = ai.routesChain()
  const geocoder = new Geocoder(deps.fetchFn)
  for (const group of chunk(todo, config.routesBatchSize)) {
    const request = group.map((g, i) => ({
      id: String(i),
      text: g.text,
      publishedOn: parisDay(g.publishedAt),
    }))
    let marches: DetectedMarch[]
    try {
      marches = await inSpan('ingest.routes', { items: group.length }, () =>
        detectRoutes(chain, request),
      )
      result.calls++
    } catch (e) {
      deps.log.warn({ err: e instanceof Error ? e.message : String(e) }, 'route detection failed')
      if (e instanceof AiError && ['billing', 'budget', 'disabled', 'auth'].includes(e.kind)) break
      continue
    }
    const model = [...chain.served].at(-1) ?? null
    const found = new Map<string, number>()
    for (const m of marches) {
      const article = group[Number(m.itemId)]
      const domain = article && (article.publisherDomain ?? extractDomain(article.url))
      if (!article || !domain) continue
      const proposal = await buildProposal(deps, geocoder, m, article.publishedAt)
      const inserted = await db
        .insert(schema.routeProposals)
        .values({
          url: article.url,
          domain,
          articleTitle: article.title.slice(0, 300) || null,
          publishedAt: article.publishedAt,
          model,
          promptVersion: ROUTES_PROMPT_VERSION,
          ...proposal,
        })
        .onConflictDoNothing()
        .returning({ id: schema.routeProposals.id })
      if (inserted.length > 0) {
        result.proposals++
        found.set(article.url, (found.get(article.url) ?? 0) + 1)
      }
    }
    await db
      .insert(schema.routeScans)
      .values(group.map((g) => ({ url: g.url, found: found.get(g.url) ?? 0 })))
      .onConflictDoNothing()
    result.scanned += group.length
  }
  await deps.events.emit({ stage: 'routes', outcome: 'ok', detail: { ...result } })
  await deps.aiUsage.flush()
  if (result.more && result.scanned > 0) await deps.trigger('routes')
  return result
}

/** Everything a person needs to judge a detected march: points on the map, a route, warnings. */
async function buildProposal(
  deps: IngestDeps,
  geocoder: Geocoder,
  m: DetectedMarch,
  publishedAt: Date,
) {
  const commune = await geocoder.commune(m.city)
  const warnings: string[] = []
  const places: ProposalPlace[] = []
  for (const p of m.places) {
    const fix = commune
      ? await geocoder.place(p.name, commune)
      : { name: p.name, quote: '', lng: null, lat: null, label: null, status: 'none' as const }
    places.push({ ...fix, name: p.name, quote: p.quote })
  }
  if (!commune) warnings.push(`Commune « ${m.city} » introuvable`)
  const walk = await walkPlaces(deps.fetchFn, places)
  warnings.push(...walk.warnings)
  const route = walk.route
  const day = m.day ?? (m.timing === 'ongoing' ? parisDay(publishedAt) : null)
  if (!day) warnings.push('Date du cortège absente de l’article')
  return {
    city: commune?.name ?? m.city,
    citycode: commune?.code ?? null,
    day,
    timing: m.timing,
    title: m.title || `Cortège à ${m.city}`,
    places,
    line: walk.line,
    lineKm: route?.km ?? null,
    warnings,
    groupKey: groupKeyOf(commune?.code ?? null, m.city, day),
  }
}

/**
 * The walking route through the places that were found, and what a person should look at. The
 * line is kept only when it looks right: a route that is far too long or twisted usually means a
 * misplaced point, and drawing it would make the error look official.
 */
export async function walkPlaces(fetchFn: IngestDeps['fetchFn'], places: ProposalPlace[]) {
  const warnings: string[] = []
  for (const p of places) {
    if (p.status === 'none') warnings.push(`Lieu introuvable : ${p.name}`)
    if (p.status === 'weak') warnings.push(`Lieu incertain : ${p.name} (à vérifier sur la carte)`)
  }
  const points = places.flatMap((p) =>
    p.status === 'ok' && p.lng != null && p.lat != null ? [[p.lng, p.lat] as [number, number]] : [],
  )
  const allFound = points.length === places.length
  const route = allFound ? await walkingRoute(fetchFn, points) : null
  const routeProblems = routeWarnings(route, allFound)
  warnings.push(...routeProblems)
  return {
    route,
    warnings,
    line: route && routeProblems.length === 0 ? route.line : null,
  }
}
