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

## Data

Migration `0010_movements`: `movements` and `movement_events` (a route is a GeoJSON coordinate
list in a `jsonb` column, `[lng, lat]` pairs). Pure rules live in `packages/core/src/movements.ts`
(route validation, status of an event at a given time, slugs).

## API

- Public: `GET /api/movements` (active first, then archives), `GET /api/movements/:slug`
  (the movement and its published events).
- Staff, permission `movement:manage` (admins), every action audited: `POST /api/staff/movements`,
  `PATCH /api/staff/movements/:id` (edit, archive, reopen),
  `POST /api/staff/movements/:id/events`, `PATCH /api/staff/movement-events/:id`.

Gotcha: in Elysia, `t.UnionEnum` makes its first value the default. For optional enum fields use a
union of literals (see `oneOf` in `modules/movements/model.ts`), otherwise a partial edit silently
resets the field.

## Not done yet

- Reading routes from articles (extraction, geocoding, routing). Measure first how many articles
  name a usable route.
- Attaching school blockades and the history replay to a movement; the home page showing the
  active movement.
- An admin panel (staff use the API for now), open-data views per movement, the "watch".
- Other themes. Each one needs a precise definition, identified sources, a verification rule and
  an owner before it goes in.
