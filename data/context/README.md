# Kingston context sources

`public/context/kingston.json` provides Kingston-wide context. Each card records its scope, source and observation date when available. The top-level `asOf` dates the Roads ACT check. Availability refers to what Territory Atlas can show. Follow the source link for current conditions and property-specific information.

## Neighbourhood checks

| Topic | Source and scope |
| --- | --- |
| Flood mapping | [ACT Government flood guidance](https://www.act.gov.au/environment/water/flood-maps), [official map](https://www.actmapi.act.gov.au/map-links/flood-map) and [ACT Government description of street- and block-scale gaps](https://www.parliament.act.gov.au/__data/assets/pdf_file/0011/3032786/EP-QTON-03-Answer-CED-Flood-Modelling-CLAY.pdf). ACTmapi provides indicative mapping of major stormwater channels, creeks and rivers. Street-scale overland flooding, blocked drains and individual-block drainage require separate checks. |
| Bushfire prone areas | [ACT Emergency Services Agency](https://esa.act.gov.au/be-emergency-ready/bushfires) and [official map](https://www.actmapi.act.gov.au/map-links/bushfire). The designation can inform development assessment. Building- or unit-level risk requires other evidence. |
| Everyday access | [Libraries ACT](https://www.library.act.gov.au/visit/find-us), [Transport Canberra maps](https://www.transport.act.gov.au/getting-around/find-a-stop-or-map) and [Transport for NSW station information](https://transportnsw.info/stop?q=26041). These are facility and network references. |
| Playground and drinking fountain inventory | ACT Government Open Data [playground assets](https://www.data.act.gov.au/d/e4ug-7r3x) and [drinking fountain assets](https://www.data.act.gov.au/d/xfiz-thuk). Counts use active records with an exact `KINGSTON` suburb tag. Several records can share a location. Asset records indicate inventory status. Privately managed and unlisted facilities may be missing. Only counts are published in the UI. |

The hazard cards link out to the official checks. The application holds no property-level hazard assessments or hazard-layer replicas.

## Today and this week

- [Roads ACT's closure map](https://www.cityservices.act.gov.au/roads-and-paths/act_public_road_closures) uses planned and unplanned road and footpath layers. The script checks that all four layers are present in the official map and validates field types, feature counts and coordinate reference. It uses the ACTmapi Kingston division's WGS 84 bounding box for queries, then filters each returned pin against the division polygon. The card counts date-bounded notices whose published date ranges intersect the seven days from capture. Counts may include overlapping notices. Pin locations can differ from the actual extent of a closure. Exact hours, conditions, and other road managers' notices require the official sources. Notices without both dates are outside this summary.
- [Transport Canberra](https://www.transport.act.gov.au/contact-us/information-for-developers) requires access approval for its MyWay+ developer feeds. Use its [journey planner](https://www.transport.act.gov.au/) or [service alerts](https://www.transport.act.gov.au/news/service-alerts-and-updates). Territory Atlas publishes no departure times, delay estimates or route-specific transit alerts.
- [VisitCanberra](https://visitcanberra.com.au/events) offers Today and Next 7 days filters. [Events Canberra explains ATDW listing coverage](https://events.canberra.com.au/event-organisers/listing-your-event), and [ATDW's distributor programme](https://www.atdw.com.au/distributors) provides licensed API access. Territory Atlas links to the public calendar.

The closures receipt records published service identities, feature selection, results and publisher edit timestamps. The card's timestamp represents the check time. Its expiry is at most 24 hours after the first layer check, or sooner when a known notice changes the rolling seven-day count. Expired information should display as stale, without the prior count. An incomplete refresh exits with an error and retains the last successfully published snapshot, whose original date and expiry still apply.

## Refresh and verify

Run from the project directory with Node.js 24.

```text
node scripts/context/refresh.mjs
node scripts/context/refresh.mjs --refresh-amenities
node scripts/context/refresh.mjs --check
node --test scripts/context/refresh.test.mjs
```

The default refresh updates closures. The second command refreshes closures plus the less time-sensitive inventories. For a production-mode local server, rerun the project build so its `dist/` contains the new context. `--check` regenerates from the saved receipts and checks the public JSON byte for byte. The script uses public sources without credentials. Refresh runs on demand.

## Attribution

Road and footpath notices originate with Roads ACT, City and Environment Directorate, © Australian Capital Territory. Territory Atlas derives a spatially filtered, date-bounded aggregate from the four public map layers. The [unplanned road closure catalogue entry](https://www.data.act.gov.au/Transport/Unplanned-Road-Closures-Live-Stream-/2sn6-ma2c) identifies [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Its adapted contribution is available under the same licence. The other layers' ArcGIS item metadata does not name a separate licence. The public card contains counts and a source link.

Kingston division geometry is ACTmapi © Australian Capital Territory under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Territory Atlas uses it for spatial filtering. See [the geometry manifest](../geo/manifest.json) and [ACTmapi terms](https://www.actmapi.act.gov.au/terms-and-conditions). Amenity counts are derived from the named ACT Government asset registers.
