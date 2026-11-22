# Kingston daily-life amenities

`public/amenities/kingston.json` is a static public snapshot for Kingston and a rectangular surrounding extent. It contains 612 facility or path records and the nearest record in each covered category for 4,660 ACT address IDs. `manifest.json` records the exact public SHA-256, source queries, row counts and address-source hash. Refresh is manual:

```powershell
node scripts/amenities/refresh.mjs
node scripts/amenities/refresh.mjs --use-saved-osm
node scripts/amenities/refresh.mjs --check
node --test scripts/amenities/refresh.test.mjs
```

The collector requires Node.js 24 and no credentials. The default refresh fetches the OSM category query and saves its raw response to `data/amenities/osm-capture.json`. `--use-saved-osm` reuses that captured response while refreshing the ACT sources; this is useful for reproducing the OSM part without another public API request. The collector fails before publishing if a source fails, returns malformed data, or duplicates a feature ID. It writes the public snapshot and manifest after fetching all required sources. Refresh writes these files in sequence, so an interrupted write requires rerunning refresh or restoring the previous matching set. `--check` verifies the public snapshot against the manifest; the test checks published structure and independently recomputes sampled nearest distances.

## Scope and interpretation

The extent is longitude 149.114–149.177 and latitude -35.340–-35.289, approximately 2 km beyond the Kingston division's bounding box. This is a rectangle, not an exact polygon buffer. The source queries return records intersecting this rectangle. A polygon or line is represented by its geometry bounding-box centre, then included only if that point is inside the extent. Thus a park or path crossing the extent can be excluded when its centre lies outside. All source points also lack verified entrances. `coordinateConfidence` states whether the displayed coordinate is a source point, an approximate official-page map coordinate, or a geometry bounding-box centre.

`nearestByAddressId` uses ACT address points from `public/geo/kingston-addresses.geojson`. Distances are rounded WGS 84 haversine straight-line distances to the displayed amenity point. For polygons and paths, this is distance to the bounding-box centre, **not** the nearest edge, access point, or usable route. A line of sight can cross barriers or water. The data gives no walking, driving, cycling, time, accessibility, entrance, service frequency, school enrolment, or catchment claim. A bus stop's location does not establish that it remains served today. Check official sources for current operations and eligibility.

## Sources and coverage

| Category | Source | Coverage note |
| --- | --- | --- |
| Public schools | [ACT Government public school directory](https://www.act.gov.au/education-and-training/find-a-school-and-enrol/list-of-act-public-schools) | The directory's embedded map provides approximate point coordinates. Six mapped school cards fall within the extent. The points are not school entrances or enrolment areas. |
| Bus stops | [Transport Canberra Bus Stop view](https://www.arcgis.com/home/item.html?id=bf45cda4089c4f03bf50d0b379d0c0fb) | ACTmapi view; source edit timestamp is recorded in the manifest. Location inventory may lag live service changes. |
| Urban open space | [ACTGOV Urban Open Space Asset](https://www.data.act.gov.au/d/5w5c-3ghz) | Active park, pedestrian parkland and semi-natural open-space asset subtypes only. Operational boundaries, not legal reserve or planning-zone boundaries. Road verges and medians excluded. |
| Cycle paths | [ACTGOV Community Path Assets](https://www.data.act.gov.au/d/eu7q-i9jx) | Active cyclepath and separated-cyclepath assets only. Footpaths are excluded from this compact point inventory; it is not a routable network. Other owners' assets can be absent. |
| Playgrounds | [ACTGOV Playground Assets](https://www.data.act.gov.au/d/e4ug-7r3x) | Active assets, polygon centres. Private and unlisted playgrounds can be absent. |
| Drinking fountains | [ACTGOV Drinking Fountain Assets](https://www.data.act.gov.au/d/xfiz-thuk) | Active registered point assets. Private and unlisted fountains can be absent. |
| Groceries, cafés, medical | [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), queried via the [dresel.systems Oceania Overpass service](https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances) | 18 grocery, 71 café and 11 medical tagged objects. This is community-maintained, incomplete coverage; categorisation follows OSM tags and does not verify current operation, opening hours, service type or quality. |

ACTmapi's bus stop item states [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) and attribution to © Australian Capital Territory. The spatial asset registers and school directory are credited to their publishers in each feature; confirm each dataset's current reuse terms before redistribution beyond this derived snapshot. The OSM subset is attributed to OpenStreetMap contributors under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). The public file combines separately attributed ACT and OSM feature records; downstream reuse of the OSM-derived part must comply with ODbL. The external basemap has its own attribution. The OSM source database timestamp and raw-capture hash are recorded in the manifest. An earlier attempt against overpass-api.de timed out; Private.coffee returned HTTP 429. The listed dresel.systems Oceania endpoint returned the captured data.

Refresh captures a new observation time, not an automatic currency guarantee. The manifest records returned versus retained counts and exact query URLs so discrepancies can be investigated. Address records can share a coordinate; each retains its own nearest-category result by official ID.
