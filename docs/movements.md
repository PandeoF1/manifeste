# Movements (proof of concept)

The site started as a map of blocked schools. A **movement** is a dated campaign ("Lycéens,
automne 2026") that groups **events** (marches, rallies, blockades). The home page keeps showing
the school blockades; movements live next to them, at `/mouvements`.

## Concept

- A movement is **active** or **archived**. Archiving sets its end date and keeps everything: the
  page, the map and the data stay at the same address (`/mouvements/<slug>`).
- An event belongs to a movement (or to none: a future "watch" of everything else).
- A march can carry a **route** drawn on the map. Every route says how reliable it is:
  `announced` (given by the organisers or the prefecture, drawn solid) or `probable` (computed
  between the places an article names, drawn dashed and labelled "à vérifier"). A route without a
  basis is refused by the database.
- The school reports (`reports`, `schools`) are a separate, older model and are not touched.

## Visibility

The public pages are **hidden by default**: the setting `movements_public` (admin, Réglages, « Page
Mouvements publique ») is off. While it is off, the menu entry, `/mouvements`, `/mouvements/<slug>`
and `GET /api/movements*` answer as if they did not exist (404), but staff keep the admin tab and
`GET /api/staff/movements` to prepare content. Switching it on is a runtime change, no deploy
(visitors get it within about a minute: the public settings are cached for 60 s).

## Data

Migration `0010_movements`: `movements` and `movement_events` (a route is a GeoJSON coordinate
list in a `jsonb` column, `[lng, lat]` pairs). Pure rules live in `packages/core/src/movements.ts`
(route validation, status of an event at a given time, slugs).

## API

- Public: `GET /api/movements` (active first, then archives), `GET /api/movements/:slug`
  (the movement and its published events).
- Staff, permission `movement:manage` (admins), every action audited: `POST /api/staff/movements`,
  `PATCH /api/staff/movements/:id` (edit, archive, reopen), `GET /api/staff/movements/:id/events`
  (all events, hidden ones included), `POST /api/staff/movements/:id/events`,
  `PATCH /api/staff/movement-events/:id`.

## Admin

The **Mouvements** tab (admins only) creates, archives and reopens movements, and lists their
events with a status selector and a hide / show button. Adding an event takes a type, title, place,
dates, a start position and a route: one `latitude, longitude` pair per line (the order Google Maps
copies), or a GeoJSON `[[lng, lat], ...]` list. The form shows the length it read, as a sanity
check (a swapped latitude and longitude usually gives an absurd length), and refuses a route whose
reliability (announced or probable) is not chosen.

Gotcha: in Elysia, `t.UnionEnum` makes its first value the default. For optional enum fields use a
union of literals (see `oneOf` in `modules/movements/model.ts`), otherwise a partial edit silently
resets the field.

## Not done yet

- Reading routes from articles (extraction, geocoding, routing). Measured on 150 articles: 43 % of
  the articles about a march carry a start and an arrival, and about a quarter of events would get a
  plausible line with a naive pipeline. Go, as proposals a person validates:
  see `docs/measurements/route-measurement.md`.
- Attaching school blockades and the history replay to a movement; the home page showing the
  active movement.
- Open-data views per movement and the "watch".
- Other themes. Each one needs a precise definition, identified sources, a verification rule and
  an owner before it goes in.

## Detected routes

Marches found in the press arrive as proposals to check by hand: see [route-detection.md](route-detection.md).
