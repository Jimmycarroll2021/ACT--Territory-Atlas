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
- Select **Synthetic example** in a property record to see fictional characteristics and sale history, explicitly labeled throughout. A local profile without curated evidence displays **Unavailable**. Some blocks have no address record.
- **Layers** controls visibility. Sources and licence information are available in **Data sources** and [the full source manifest](data/geo/manifest.json). Street tiles and labels use OpenFreeMap Positron when available. Official GeoJSON layers remain usable if external tiles fail.

## Public build and private records

The static site is the content of `dist/`, suitable for a static host at its domain root. It contains the public map and synthetic example. No deployment is included. Source files in `data/private-prep/` are outside the static build. Local features and sale history require independently authorised evidence. No actual private property record or sales extract is supplied.

For an independently authorised dataset only, the optional server-side variable `KINGSTON_PRIVATE_DATA_PATH` names an external JSON file outside this project. It must be an object keyed by official ACT address ID with matching `addressId` on each record. The only response fields are `addressId`, `displayAddress`, `beds`, `baths`, `parking`, `featuresSource`, `featuresObservedAt` and `sales`. Each sale can expose `date`, `price`, `source` and `matchStatus`. Never place this file in the project, `public`, or a browser environment variable. The loopback API returns one record per GET to `/api/properties/<addressId>`, declines cross-site requests and sends `Cache-Control: no-store, private`. Without an authorised file, the endpoint returns 404 and the panel displays **Unavailable**.

## Data sources

Registered property and administrative geometry is from ACT Government / ACTmapi. Urban extent is from the Australian Bureau of Statistics, ASGS Edition 3 (2021). Each layer’s publisher, source URL, licence, scope, extraction filter, count and file SHA-256 are recorded in [the source manifest](data/geo/manifest.json). OpenFreeMap, OpenMapTiles and OpenStreetMap contributors provide the external basemap. Fonts and application code are packaged locally.

