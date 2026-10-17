# Can routes of marches be read from the press? A measurement

Question: before building automatic detection of march routes for the Mouvements pages, how many
press articles about a demonstration carry a usable route, and can the places be turned into a line
on the map?

Short answer: **yes, as a proposal that a person validates, not as automatic publication.**

## Method

- **Sample.** 20 Google News queries (march, route, high-school students, strike, and one per big
  city), last 30 days, 884 distinct articles. 150 drawn at random (fixed seed, at most 4 per
  outlet, 87 outlets), read with the project's own reader (same code as production, reading
  gateway on).
- **Labels.** Each article is read in full and given one class for the best route information in
  the text read:
  - **A**: a full route, at least 3 named places or streets in order.
  - **B**: the start and at least one other named point (arrival or passage).
  - **C**: places named, but no route (one meeting point, a start only, incident sites).
  - **D**: no usable place.
  - Also: topic (M march or rally, K blockade or strike only, O other), timing (before, during,
    after the event) and whether the date is stated.
- **Check of the labels.** A second annotator, with no access to the first labels, classified 30
  articles. A re-audit then searched the other readable C and D articles for route wording.
- **Places to a line.** For one article per event with A or B (37 events, 141 places): each place is
  searched with Nominatim (OpenStreetMap), kept if it falls within 12 km of its city, then a walking
  route is computed between the places found, in order, with the public OSRM server.

## Results

150 articles: **129 about a march or rally (M)**, 11 about blockades or strikes only (K), 10 other
(foreign news, fact checks, analysis, union statements).

| Route information in the article (M, n = 129) | Articles | Share    |
| --------------------------------------------- | -------- | -------- |
| A: full route                                 | 29       | 22 %     |
| B: start and arrival (or a passage)           | 26       | 20 %     |
| C: places, no route                           | 25       | 19 %     |
| D: nothing usable                             | 49       | 38 %     |
| **A or B**                                    | **55**   | **43 %** |

What changes the picture:

- **Reading.** 52 of 150 articles (35 %) give only the title or a summary; none of the 44 such
  articles about a march carries a route (4 name a single place). Among the 85 readable ones,
  **A or B is 65 %**. Across the sample, 21 pages answered HTTP 403, 17 were flagged as behind a paywall and 23 Google links could not be decoded to the real article; these overlap and explain most of the title-only cases.
- **Timing.** Announcements are the richest: **54 % of the articles written before the event give
  A or B** (26 of 48), against 41 % afterwards and 27 % during (3 of 11). The routes are known
  the day before, not while it happens.
- **Headline.** A title with "parcours", "itinéraire", "trajet" or "tracé" is a strong signal: 11 of
  the 12 readable ones carry a route.
- **Sources.** A date or time is stated in 78 % of the articles. National and regional outlets do
  about the same (41 % and 44 %). City-guide pages (Sortir à Paris: 4 articles out of 4 with a full route) and some local dailies (Midi Libre: 3 out of 4) are the richest; the per-outlet counts are small.
- **Events, not articles.** The 129 articles describe 81 distinct events (the 17 October march in
  Paris alone: 14 articles). **49 % of the events have at least one article with A or B.**
- **Sources disagree.** For Paris on 17 October the route was disputed for two days: Bastille to
  Clichy, then République to Clichy, and one outlet still wrote République to Nation. One outlet
  deduced a route from metro closures and said so. The route must belong to an event, with a date
  and a source, and a later or official source must win.

Places to a line (37 events with A or B):

- **87 % of the places are found** in the right city (A: 89 %, B: 81 %). The misses are colloquial
  or generic names ("campus", "préfecture", "haut de la Canebière", "esplanade", "gare") and some
  ambiguous street names matched in the wrong place.
- A walking route could be computed for 32 of 37 events, and **26 of them are plausible** (between
  200 m and 15 km, not a detour of more than 3.5 times the straight line). The six others: four in Montpellier (misplaced points, one of them a 34 km "route") and two (Besançon, Strasbourg) whose walking route is more than 3.5 times the straight line, which can be a real detour around a river or an old town: the heuristic cannot tell. Five more events had only one of their two places found, so no line.
- **20 of 37 events (54 %) are fully resolved and plausible without any human check.** Taking the
  49 % of events with a route in the press, about a quarter of all events would get a plausible line
  automatically with this naive pipeline.

## Reliability of the measurement

- Agreement between the two annotators on 30 articles: **87 % identical class** (Cohen's kappa
  0.81) and **90 % on the split that decides** (A or B against C or D).
- The four disagreements were the first annotator's mistakes, all in the same direction (a route
  missed). The re-audit found three more; **7 corrections** in total, all of them upward (a route missed or under-rated), applied before the figures above. Timing is less reliable (83 % agreement: "during" versus "before" or
  "after").
- A blind check sheet of 20 articles is in `route-check-sheet.csv` for a human to classify.

## Limits

- Most of the sample belongs to one cycle of mobilisation (the strike of 29 September, the high-school days from 6 to 17 October); about ten articles concern other marches (climate, Pride, a parade, a charity walk, a march against a law). The queries mention routes
  and marches, which favours route-rich articles.
- Nominatim only: the French national geocoder and the IGN one were unreachable from the
  measurement environment, so the 87 % is probably conservative for the places of a French town.
- "Plausible" is a heuristic. There is no ground truth of the real route, so the accuracy of the
  geometry itself is not measured.
- 129 articles give about plus or minus 9 points on a share of 43 %.

## Decision

Both thresholds set beforehand are met (A or B of at least 35 % of the articles, at least 80 % of
the places found): **build detection, as proposals.**

1. An AI task that reads an article and returns, per event: title, date and time, and the ordered
   places of the route (verbatim, with the sentence they come from), as the existing extraction does.
   Priority to articles written before the event and to titles with "parcours".
2. Resolve the places with the French national geocoder, a list of well-known places (préfectures,
   stations, universities) and the city as a bounding box; compute the line with a routing engine.
3. Group by city and date, keep every source, let the latest or official one win, mark a route
   "disputed" when sources disagree. A computed route is always `probable`; only a route stated in
   full by an official source or the organisers is `announced`.
4. Nothing is published without a person: proposals go to a queue in the admin, with a map preview
   and the length of the route (the guard against swapped or misplaced points).
5. Fix the reading first: remove soft hyphens, decode the remaining Google links, and look at the
   sites that refuse robots (HTTP 403 for 21 articles).

Files: `route-sample-labels.csv` (labels, links and titles, no article text) and
`route-check-sheet.csv` (the blind check).
