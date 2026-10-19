# Mobilisations signalées (toute la France)

The home map shows, besides the schools, every street demonstration the press reports in France.
They are events of the [movements](movements.md) model with the kind `signaled` ("Mobilisation
signalée"), without a movement (`movement_id` null: a "veille"). Off by default: setting
`signaled_mobilisations`.

## Flow

1. **Discover** (`ingest/discover.ts`). With the setting on, an article that is not about a school
   but matches `isDemonstration` (`packages/core/src/relevance.ts`) is kept with
   `ingest_items.scope = 'demonstration'`. Without it, nothing changes for the school pipeline.
2. **Read** as usual, then the `ingest.signals` queue is triggered.
3. **Signals stage** (`ingest/signals-stage.ts`): one AI call per article (task `signals`, models of
   `tasks.media`, prompt `packages/ai/src/prompts/signals.ts`). The model returns, per city, the
   day and the place with its level (`rue`, `lieu`, `arrondissement`, `quartier`, `ville`) and a
   quote. The parser checks that the city and the quote are in the text, otherwise it falls back to
   the city level. `signal_scans` remembers the articles already scanned.
4. **Placement** (`placeSignal`, geocoder `zone()`):
   - street / place found → a point (`precision = 'point'`);
   - district / neighbourhood (`13e arrondissement`) → its contour, else a circle of 700-1200 m;
   - otherwise the whole commune (contour from geo.api.gouv.fr, else a 2.5 km circle).
     A place that cannot be found is never guessed: the zone gets wider, never elsewhere.
5. The event is **published at once** (`hidden = false`) with a `dedupe_key` (commune + day + place)
   so that the same demonstration read in several articles is one event.

Dates: ongoing today → publication time; otherwise noon in Paris of the day found. An announcement
without a day is skipped; a day outside -14 / +21 days of the publication is dropped.

## API and map

- `GET /api/mobilisations?period=live|24h|7d|all`: public, empty unless the setting is on, cached
  60 s, capped at 1500. `live` keeps what started less than 4 h ago.
- `GET /api/staff/mobilisations`: admins, hidden ones included. Hide with
  `PATCH /api/staff/movement-events/:id {hidden}` (admin tab "Mobilisations signalées").
- Map: red translucent zone with a dashed outline, red point with a ring. Under the schools.

## Setup

1. Admin → Sources: add the group "Presse : manifestations (toute la France)" (presets).
2. Admin → Réglages: turn on "Mobilisations signalées (toute la France)".

## Limits

- Nothing is checked by hand before publication: hide wrong ones from the admin tab.
- Cost: about one cheap AI call per demonstration article.
- Not yet: attaching a signaled event to a movement, regional filters, merging with approved marches.
