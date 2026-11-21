# Kingston planning snapshot

The map joins gazetted Territory Plan polygons and published development applications to the 375 registered Kingston block keys in its cadastral layer. The dated snapshot covers the ACTmapi records available during capture. An ACTmapi application polygon can represent an entire cadastral parcel. Its boundary describes the source record's extent and can differ from the proposed works.

## Refresh and verify

Run these commands from the repository root with uv and Python 3.12. The scripts declare their pinned Python dependencies. The web application serves the resulting static JSON without Python or live GIS requests.

```powershell
uv run --python 3.12 scripts/planning/refresh.py
uv run --python 3.12 scripts/planning/refresh.py --check
uv run --python 3.12 scripts/planning/test_planning.py
```

The first command reads four official feature layers. For each filter it checks the independent count against the complete object-ID inventory. It fetches the union of IDs in pages of at most 60 features, checks the exact identity of each page, requires EPSG:7855 and checks the source edit timestamp at the beginning and end of each layer read. Catalogues must advertise the recorded CC BY 4.0 licence. Unexpected input, missing page IDs, a changed base block inventory or a changed licence stops publication. A valid response with zero qualifying DAs is supported. The date window uses the UTC capture date, includes both endpoint dates and subtracts five calendar years with a leap-day adjustment.

The builder archives allowlisted source attributes and source coordinates under `data/planning/sources/`. It derives and validates both display files before publishing. It writes the immutable data first and atomically replaces `public/planning/current.json` last. Readers should resolve this pointer once for each map session to use a consistent pair across refreshes. The stable `zoning.json` and `da.json` aliases each use an atomic file replacement. A kernel lock serializes writers during publication. Older content-addressed releases remain available to existing readers.

The second command uses the archive named in `manifest.json` to rebuild both display files offline, verify the exact bytes of the release files, aliases, manifest and pointer, and check the bundled base map hash. The final command exercises synthetic edge cases and two fixed examples from the 21 November 2026 archive. To explicitly republish an archived release, run `uv run --python 3.12 scripts/planning/refresh.py --replay <source-archive.json.gz>` against its matching base map.

## Source and method

| Layer | Included features |
| --- | --- |
| [ACTmapi registered blocks](https://services1.arcgis.com/E5n4f1VY84i0xSjy/ArcGIS/rest/services/ACTGOV_BLOCKS/FeatureServer/0) | Registered Kingston blocks whose key set exactly matches the map. Native polygons supply projected areas and distances. |
| [Territory Plan Land Use Zones](https://services1.arcgis.com/E5n4f1VY84i0xSjy/ArcGIS/rest/services/ACTGOV_TP_LAND_USE_ZONE/FeatureServer/1) | Gazetted polygons intersecting the union of registered Kingston parcels. |
| [Active development applications](https://services1.arcgis.com/E5n4f1VY84i0xSjy/ArcGIS/rest/services/ACTGOV_ACTIVE_DEVELOPMENT_APPLICATIONS/FeatureServer/0) | All published active records within scope, without a lodgement-date cutoff. |
| [Completed development applications](https://services1.arcgis.com/E5n4f1VY84i0xSjy/ArcGIS/rest/services/ACTGOV_COMPLETED_DEVELOPMENT_APPLICATIONS/FeatureServer/0) | In-scope completed records with a published decision date in the five-year window. |

ACTmapi © Australian Capital Territory. The products are derived from these source layers using polygon intersection, attribute grouping and distance calculations. The manifest records the catalogue item, layer, retrieval and edit times, filter expressions, fields, query counts, per-page ID hashes and source/output hashes. [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) · [ACTmapi terms](https://www.actmapi.act.gov.au/terms-and-conditions)

All operations use GDA2020 / MGA zone 55 (EPSG:7855, metres). The source archive stores polygon coordinate arrays in this CRS. Invalid polygons are repaired with GEOS for calculations while the archive retains the original coordinates. The DA queries use the parcel envelope expanded by 500 metres as a spatial candidate filter, then apply an exact minimum geometry distance of at most 500 metres to the union of registered parcel polygons. This includes adjoining divisions. Additional exact-key queries cover qualifying records whose polygons are displaced or absent. Each parcel's nearby list uses the shortest distance to any retained source geometry for a DA. Boundary contact can produce a nearby distance of zero. Neither centroid proximity nor a suburb-name match establishes an on-block association.

## Display schema, version 1

Both release files contain `schemaVersion`, `snapshotId`, `snapshotDate` and a `byBlock` dictionary keyed by decimal `BLOCK_KEY` strings. Unknown block keys are outside the included inventory.

| Field | Meaning |
| --- | --- |
| `zoning.sourceUrl` | Official gazetted polygon layer. |
| `zoning.byBlock[key].zones` | Descending area by zone code. Each entry includes `code`, source `label`, `areaM2`, block-relative `percent`, `sliver`, `sourceIds` and per-feature `intersections` containing `sourceId` and `areaM2`. Multiple fragments of a code use their union area. |
| `blockAreaM2`, `gapAreaM2`, `gapPercent`, `hasGap` | Parcel area and the part outside the union of all gazetted intersections. An empty zone list represents unavailable coverage. |
| `overlapAreaM2`, `hasOverlap` | Excess area counted across different zone codes. Coverage percentages can sum above 100 when published codes overlap. |
| `da.sourceUrls`, `completedSince`, `radiusM` | Official active and completed layers, inclusive start of the decision window and inclusive nearby radius. |
| `da.applications[number]` | One display entry per distinct DA number. Includes `number`, `status`, `lodgementDate`, `decisionDate`, `decision`, `types`, `subclasses`, `divisions` and `blockKeys`. Dates use ISO calendar dates or null. A decision is the recorded outcome, which may include refusal or withdrawal. |
| `da.byBlock[key].onBlock` | Sorted DA numbers whose retained source rows explicitly carry the selected block key. |
| `da.byBlock[key].nearby` | Distinct `{number, distanceM}` entries within 500 metres, ordered by increasing metric distance. Exact-key matches are excluded here. Distance is rounded to a millimetre after inclusion testing. |

Zone groups below 1 m² **or** 0.1% of the parcel area are flagged as slivers. They remain in the display data with their evidence. A 0.000001 m² tolerance suppresses numerical overlay noise and edge-only contacts. The same tolerance governs the gap and cross-code overlap flags. Each source application row and its original block key remain in the compressed archive. The display joins all reported classes and keys for a DA, selects its earliest available lodgement and latest available decision, and gives an active source row precedence for the display status if both layers carry the same number.

The archive's DA attribute allowlist contains identifiers, division/section/block references, public classification, dates and the completed outcome. The public files expose the fields documented above. Sale prices, parties, contact details, officer details, application documents and free-text proposals are outside this data product.
