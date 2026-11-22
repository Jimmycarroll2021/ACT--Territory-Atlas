# Local commute API

The server serves same-origin, loopback-only JSON. It never accepts API credentials or remote service URLs from a browser request.

- `GET /api/commute/status` reports routing capability and the Roads ACT source.
- `GET /api/commute/journey?originLon=149.14&originLat=-35.31&destinationLon=149.15&destinationLat=-35.32&departure=2026-11-22T09:00:00%2B11:00&mode=walk` validates a selected origin, destination, zoned departure and `walk` or `transit` mode. It currently returns `status: "unavailable"`, `durationMinutes: null` and `itinerary: null`. A routing engine and approved MyWay+ timetable access are absent; no route or duration is inferred.
- `GET /api/commute/roads?departure=2026-11-22T09:00:00%2B11:00&mode=walk` reads the saved four-layer Roads ACT capture in `data/context/kingston-closures.json`. It returns Kingston notice points whose published date range intersects the selected 24-hour period. It checks the capture against the Kingston boundary and expires it after 24 hours. `routeImpact` stays `unknown` for all notices. A point is not a closure extent, and date overlap does not establish operating hours or effects on a chosen journey. When stale, incomplete or outside the capture's 30-day departure window, it returns `status: "unavailable"` with no notices. Follow the official map for current details.

Run `node --test scripts/commute/api.test.mjs` for validation, stale data and HTTP security checks. The existing context refresh process owns the Roads ACT capture. This module does not refresh feeds or store MyWay+ data. Revisit feed licence, local router memory and graph size before enabling routing on this laptop.
