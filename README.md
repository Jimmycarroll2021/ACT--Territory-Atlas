# Territory Atlas

An interactive Canberra property map with a territory-wide suburb index and property-level coverage in Kingston, ACT. The local geometries include the ACT boundary, the ABS 2021 Canberra–Queanbeyan (Canberra Part) Urban Centre and Locality extent, 121 ACT divisions, 375 registered Kingston blocks, 4,660 address records, 243 building footprints and 83 registered Class B unit polygons.

## Run locally

Use Node.js 24 and npm. In this directory run:

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd start
```

Open [the local map](http://127.0.0.1:4173/). For development, run `npm.cmd run dev` and open [the development server](http://127.0.0.1:5173/). Set `PORT` to change the listener port. The Node server binds to IPv4 loopback.

On another laptop, clone `https://github.com/Jimmycarroll2021/ACT--Territory-Atlas.git`, install Node.js 24 and npm, then run the commands above from the cloned project directory. The checked-in snapshots are sufficient to browse the public map without API keys. The repository is the project handoff; there is no public deployment from this work.

## Explore

- Choose any suburb in the sidebar or click its boundary. **View full ACT border** fits the legal territory. **Overview** returns to the ABS urban area.
- **Explore Kingston** opens the property explorer. Search a street address or an ACT address ID, browse by registered block, or click an address point after zooming in. A click on overlapping points presents a choice of address records.
- Select a street and then an individual address or unit. Registered blocks, addresses, building footprints and unit polygons retain their source identities. Building-footprint selection exposes the source building type and use.
- A unit outline appears only for a unique address-to-unit match on block key, unit plan and unit title. Unmatched addresses keep their own point. Unmatched footprints remain selectable. Class B unit coverage is partial.
- **Planning** shows published ACTmapi information for the selected registered block. Address and unit selections use their parent block. Mapped zones include the approximate area share and highlight small intersections, gaps and overlaps. Development applications are grouped by exact block key or mapped distance within 500 m. The panel shows the snapshot date, completed-application coverage, and official source links. A snapshot older than seven calendar days is marked stale.
- Reviewed DA Finder proposal summaries and decision evidence appear for matching applications in the pinned planning snapshot. Ambiguous, missing, changed or unreviewed DA Finder rows remain unavailable; the map's application relationships do not depend on these extra details. Proposal descriptions do not establish construction progress or nearby effects. See [DA detail method](data/planning/da-details-method.md).
- A Kingston block or address shows **hazard map screening** for published flood and bushfire prone area polygons over its registered block. A mapped intersection is not a dwelling risk rating; no mapped intersection does not rule out hazard. The same section shows approximate straight-line distances to nearby mapped schools, bus stops, open space, cycle paths, playgrounds, fountains and OSM-tagged groceries, cafes and medical facilities. Distances use mapped points or geometry centres, not walking routes, entrances, service availability or catchments. See [hazard method](data/hazards/README.md) and [amenity method](data/amenities/README.md).
- In Kingston, switch between **Location** and **Today & this week**. Location keeps the property explorer and planning details, then shows Kingston-wide location facts: links for official flood and bushfire checks, library and station references, walking and cycling maps, and ACT Government asset-register counts for playgrounds and drinking fountains. These are area context, not an assessment of a selected address or building. Use **Jump to location facts** to reach the section below the property record.
- **Today & this week** shows the dated Roads ACT road and footpath notice summary and official links for transit departures and service changes. Its commute form accepts a selected Kingston address, a mapped Kingston destination or coordinates, departure time and walking or public transport mode. The local API validates the request and reports journey times and itineraries **unavailable** because no routing engine or approved timetable feed is connected. A saved Roads ACT capture may return notice points whose published dates overlap the selected 24-hour period; route impact remains unknown, and stale captures are unavailable. The events section links to the official VisitCanberra calendar; the empty local feed means licensed access is absent, not that no events exist. See [commute API](data/commute/README.md) and [events access](data/events/README.md). The two views are available only while Kingston is selected.
- Select **Synthetic example** in a property record to see fictional characteristics and sale history, explicitly labeled throughout. A local profile without curated evidence displays **Unavailable**. Some blocks have no address record.
- **Layers** controls visibility. Sources and licence information are available in **Data sources** and [the full source manifest](data/geo/manifest.json). Street tiles and labels use OpenFreeMap Positron when available. Official GeoJSON layers remain usable if external tiles fail.

The overview loads the three territory layers first. The four Kingston layers load on entry to Kingston or on a Kingston deep link. Successful layers are reused for the session and unavailable layers can be retried. Planning loads on the first block or address selection and follows one published snapshot via `public/planning/current.json`. Kingston context loads from `public/context/kingston.json` when Kingston opens, with a retry button if that file is unavailable. The map and property explorer continue to work if a planning or context file is unavailable.

## Refresh Kingston context

The checked-in context snapshot was captured on **22 November 2026 at 10:46 am Canberra time** (`2026-11-21T23:46:47Z`). Its Roads ACT notice summary expires by **23 November 2026 at 10:46 am Canberra time** (`2026-11-22T23:46:45Z`), or earlier if a notice changes the rolling seven-day count. Once expired, the view marks that card **Stale** and hides its old count. Other time-sensitive cards with dated observations are also marked stale after their Canberra calendar day. Refresh is on demand; opening the site does not fetch new official notices.

Run from the project root with Node.js 24:

```powershell
node scripts/context/refresh.mjs
node scripts/context/refresh.mjs --refresh-amenities
node scripts/context/refresh.mjs --check
node --test scripts/context/refresh.test.mjs
npm.cmd run build
```

The first command refreshes the four Roads ACT closure layers. Use the second command when the playground and drinking-fountain asset counts also need refreshing. `--check` reconstructs the public JSON from the saved source receipts and checks exact bytes. Rebuild before previewing the updated `dist/` through `npm.cmd start`. The script has no credentials or automatic schedule. A failed capture leaves the previous published snapshot in place with its original date and expiry. See [context sources and method](data/context/README.md).

## Refresh the five Kingston layers

These are manual source updates. Read each layer method before refreshing, keep its evidence and public snapshot together, then rebuild. Live refresh depends on the upstream service being available and its current reuse terms.

```powershell
python -B scripts/planning/da_details.py --refresh
python -B scripts/planning/da_details.py --check
python -B scripts/planning/da_details.test.py

uv run --python 3.12 scripts/hazards/refresh.py
uv run --python 3.12 scripts/hazards/refresh.py --check
uv run --python 3.12 scripts/hazards/test_refresh.py

node scripts/amenities/refresh.mjs
node scripts/amenities/refresh.mjs --check
node --test scripts/amenities/refresh.test.mjs

node --test scripts/commute/api.test.mjs
node --test scripts/events/atdw.test.mjs
npm.cmd run build
```

The planning detail refresh publishes only reviewed exact-number DA matches. Hazard refresh needs Python 3.12 and `uv`; it verifies the official block geometry and both hazard layers before publication. Amenity refresh needs public ACT and OSM access. The commute API reads the existing context capture, refreshed with `node scripts/context/refresh.mjs`. The events file remains access-required until licensed ATDW access, a server refresh and independent live verification are completed; the test uses synthetic fixtures only. None of these commands provides a routing engine, timetable data or an events licence.

## Public build and private records

The static site is the content of `dist/`, suitable for a static host at its domain root. It contains the public map, five-layer snapshots and synthetic example. A static host does not run the loopback property and commute APIs; their responses remain unavailable without the Node server or an equivalent authorised backend. No deployment is included. Source files in `data/private-prep/` are outside the static build. Local features and sale history require independently authorised evidence. No actual private property record or sales extract is supplied.

For an independently authorised dataset only, the optional server-side variable `KINGSTON_PRIVATE_DATA_PATH` names an external JSON file outside this project. It must be an object keyed by official ACT address ID with matching `addressId` on each record. The only response fields are `addressId`, `displayAddress`, `beds`, `baths`, `parking`, `featuresSource`, `featuresObservedAt` and `sales`. Each sale can expose `date`, `price`, `source` and `matchStatus`. Never place this file in the project, `public`, or a browser environment variable. The loopback API returns one record per GET to `/api/properties/<addressId>`, declines cross-site requests and sends `Cache-Control: no-store, private`. Without an authorised file, the endpoint returns 404 and the panel displays **Unavailable**.

## Data sources

Registered property and administrative geometry is from ACT Government / ACTmapi. Urban extent is from the Australian Bureau of Statistics, ASGS Edition 3 (2021). Each layer’s publisher, source URL, licence, scope, extraction filter, count and file SHA-256 are recorded in [the source manifest](data/geo/manifest.json). OpenFreeMap, OpenMapTiles and OpenStreetMap contributors provide the external basemap. Fonts and application code are packaged locally.

ACTmapi planning data is attributed to the Australian Capital Territory under CC BY 4.0. The snapshot records mapped, gazetted zoning and active applications, plus applications completed in the five-year coverage window. Nearby applications depend on available source geometry. Check the official records for current zoning, planning controls and application decisions. [Planning snapshot manifest](data/planning/manifest.json)

