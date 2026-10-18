# Route detection

Finds marches in press articles and proposes their route. A person checks every proposal on a map
before anything is public. Off by default.

Why it is built this way: see [the measurement](measurements/route-measurement.md). In short, a
route can be read from the press for roughly a third of the marches, but the geocoding of places
of interest (stations, prefectures, campuses) is wrong about half of the time, so a machine alone
would draw false routes.

## Flow

1. **Read.** The existing read stage fetches the article. Pages that give under 1 200 characters
   (teasers, scripted live blogs) are completed through the reading gateway.
2. **Filter (free).** The routes stage only keeps articles of 400+ characters that talk about a
   march and name kinds of places. The others are marked as scanned without an AI call.
3. **AI.** One call per batch of 6 articles (`routes` task, same models as the media task). The
   model returns marches with their ordered places, and **a quote for each place**. A place whose
   quote is not in the text, a name not in its own quote, a city not in the text, or a march with
   fewer than two places is dropped by the parser. A march is also dropped unless the model gives a
   quote (checked against the text) saying that lycéens or students take part in it: taxi, biker or
   farmer marches are not ours (prompt v3).
4. **Geocoding.** The commune is found first (geo.api.gouv.fr). A place is "ok" only if the address
   base (BAN) returns it in that commune, within 7 km of the centre, and every distinctive word of
   the name is in the answer ("gare" alone proves nothing). Otherwise OpenStreetMap is tried inside
   a box around the commune. Otherwise the place stays "weak" (a guess) or "none".
   A place that is the name of another commune ("Brest" in a march of Morlaix) is refused: it is a
   trip between towns. When several communes share the commune's name (Clermont), a warning says so.
   The day must be within 14 days before and 21 days after the article, else it is dropped.
5. **Route.** Walking route through the places (public OSRM). No straight-line fallback. A route
   under 0.2 km, over 15 km or with a detour over 3.5x is flagged and not drawn.
6. **Proposal.** One per commune, day and route (same start and end): outlets reprint the same
   dispatch. Stored in `route_proposals` with warnings in French. Proposals about the same
   commune and day share a `group_key`; the admin shows them together.
7. **Decision.** Admin tab **Parcours détectés**: correct points (paste `lat, lng` from a map), the
   route is recomputed, then approve (creates a `march` event with route basis `probable`, which the
   map draws dashed) or reject. Approving can reject the other articles about the same march.

An article is read once (`route_scans`), whether or not it held a route.

## Switches and limits

- Admin setting `route_detection` (Réglages), default **off**. Plus `routeDetection` in the ingest
  config and the global AI switch and daily budget.
- At most 3 AI calls per run (`maxRoutesCalls`) of 6 articles (`routesBatchSize`).
- Only articles that already pass the pipeline's relevance filter (school and blocking words) are
  seen. Marches that never mention lycéens, étudiants or a blockade (a climate march, say) are not.

## Cost (estimate, not measured in production)

With the default model (Gemini Flash-Lite, 0.10 / 0.40 USD per million tokens): about 14 000 input
and 500 output tokens per call of 6 articles, so about **0.0016 USD per call, 0.0003 USD per
article**. 100 articles a day is about 1 USD a month, 1 000 a day about 8 USD. If the fallback
models (Flash) answer instead, multiply by about 4. The free filter removes part of the articles
before any call. The real figure shows in the IA tab under "Détection de parcours" once switched on.

## Known weak points

- Places of interest are the weak spot (about 3 in 10 schools and campuses found by the address
  base in the measurement). The OpenStreetMap fallback helps, it was not measured.
- Public OSRM and Nominatim are shared services with usage limits: the geocoder waits 1.1 s between
  Nominatim calls. A self-hosted instance is the way out if volume grows.
- Two outlets can give different routes for the same march: the admin sees both and picks.
- The reading gateway is a third-party service that receives the article URL.
