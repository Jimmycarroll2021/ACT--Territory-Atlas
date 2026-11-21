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

## Explore

- Choose any suburb in the sidebar or click its boundary. **View full ACT border** fits the legal territory. **Overview** returns to the ABS urban area.
- **Explore Kingston** opens the property explorer. Search a street address or an ACT address ID, browse by registered block, or click an address point after zooming in. A click on overlapping points presents a choice of address records.
- Select a street and then an individual address or unit. Registered blocks, addresses, building footprints and unit polygons retain their source identities. Building-footprint selection exposes the source building type and use.
- A unit outline appears only for a unique address-to-unit match on block key, unit plan and unit title. Unmatched addresses keep their own point. Unmatched footprints remain selectable. Class B unit coverage is partial.
- **Planning** shows published ACTmapi information for the selected registered block. Address and unit selections use their parent block. Mapped zones include the approximate area share and highlight small intersections, gaps and overlaps. Development applications are grouped by exact block key or mapped distance within 500 m. The panel shows the snapshot date, completed-application coverage, and official source links. A snapshot older than seven calendar days is marked stale.
- In Kingston, switch between **Location** and **Today & this week**. Location keeps the property explorer and planning details, then shows Kingston-wide location facts: links for official flood and bushfire checks, library and station references, walking and cycling maps, and ACT Government asset-register counts for playgrounds and drinking fountains. These are area context, not an assessment of a selected address or building. Use **Jump to location facts** to reach the section below the property record.
- **Today & this week** shows the dated Roads ACT road and footpath notice summary and official links for transit departures, service changes and events. Live transit data and a licensed Kingston events feed are unavailable in this view. The notice counts include mapped points in Kingston with published date ranges overlapping the seven days from capture; they do not establish current operating hours or complete disruption coverage. Open each source for a current, location-specific check. The two views are available only while Kingston is selected.
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

## Public build and private records

The static site is the content of `dist/`, suitable for a static host at its domain root. It contains the public map and synthetic example. No deployment is included. Source files in `data/private-prep/` are outside the static build. Local features and sale history require independently authorised evidence. No actual private property record or sales extract is supplied.

For an independently authorised dataset only, the optional server-side variable `KINGSTON_PRIVATE_DATA_PATH` names an external JSON file outside this project. It must be an object keyed by official ACT address ID with matching `addressId` on each record. The only response fields are `addressId`, `displayAddress`, `beds`, `baths`, `parking`, `featuresSource`, `featuresObservedAt` and `sales`. Each sale can expose `date`, `price`, `source` and `matchStatus`. Never place this file in the project, `public`, or a browser environment variable. The loopback API returns one record per GET to `/api/properties/<addressId>`, declines cross-site requests and sends `Cache-Control: no-store, private`. Without an authorised file, the endpoint returns 404 and the panel displays **Unavailable**.

## Data sources

Registered property and administrative geometry is from ACT Government / ACTmapi. Urban extent is from the Australian Bureau of Statistics, ASGS Edition 3 (2021). Each layer’s publisher, source URL, licence, scope, extraction filter, count and file SHA-256 are recorded in [the source manifest](data/geo/manifest.json). OpenFreeMap, OpenMapTiles and OpenStreetMap contributors provide the external basemap. Fonts and application code are packaged locally.

ACTmapi planning data is attributed to the Australian Capital Territory under CC BY 4.0. The snapshot records mapped, gazetted zoning and active applications, plus applications completed in the five-year coverage window. Nearby applications depend on available source geometry. Check the official records for current zoning, planning controls and application decisions. [Planning snapshot manifest](data/planning/manifest.json)

