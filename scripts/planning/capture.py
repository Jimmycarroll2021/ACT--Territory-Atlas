"""Capture the dated public-source inputs and the audit trail for an offline build."""
from calendar import monthrange
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
import json

from shapely import make_valid, union_all
from shapely.geometry import shape

from arcgis import Layer, chunks, digest

RADIUS = 500
EXPECTED_BLOCKS = 375


def key(value):
    if value is None:
        return None
    if isinstance(value, bool) or int(value) != float(value):
        raise ValueError("Unexpected cadastral/application identifier")
    return str(int(value))


def polygon(row):
    if row["geometry"] is None:
        return None
    geom = shape(row["geometry"])
    if geom.geom_type not in ("Polygon", "MultiPolygon") or geom.is_empty:
        raise ValueError("Unexpected planning geometry")
    if not geom.is_valid:
        geom = make_valid(geom)
    if geom.area <= 0:
        raise ValueError("Unusable planning polygon")
    return geom


def cutoff(day):
    year = day.year - 5
    return date(year, day.month, min(day.day, monthrange(year, day.month)[1]))


def capture(block_file):
    started = datetime.now(timezone.utc)
    day = started.date()
    block_bytes = block_file.read_bytes()
    keys = [key(f["properties"]["BLOCK_KEY"]) for f in json.loads(block_bytes)["features"]]
    if len(keys) != len(set(keys)) or len(keys) != EXPECTED_BLOCKS or None in keys:
        raise ValueError("Unexpected registered block inventory in bundled map")
    block_layer = Layer("blocks")
    ids = block_layer.ids("DIVISION_NAME='KINGSTON' AND CURRENT_LIFECYCLE_STAGE='REGISTERED'")
    blocks = block_layer.fetch(ids)
    if {key(r["properties"]["BLOCK_KEY"]) for r in blocks} != set(keys) or len(blocks) != len(keys):
        raise ValueError("ACTmapi registered block inventory differs from the map. Refresh and review the base map first.")
    extent = union_all([polygon(r) for r in blocks])
    # The bounding envelope is a complete candidate superset. Exact polygon distance
    # below avoids approximation at the round corners of a tessellated buffer.
    xmin, ymin, xmax, ymax = extent.bounds
    envelope = [xmin - RADIUS, ymin - RADIUS, xmax + RADIUS, ymax + RADIUS]
    since = cutoff(day)
    criteria = {
        "zoning": "CURRENT_LIFECYCLE_STAGE='GAZETTED'",
        "active": "1=1",
        "completed": f"DECISION_DATE >= DATE '{since}' AND DECISION_DATE < DATE '{day + timedelta(days=1)}'",
    }

    def collect(name):
        layer = Layer(name)
        where = criteria[name]
        bounds = extent.bounds if name == "zoning" else envelope
        candidates = layer.ids(where, bounds)
        keyed = set()
        if name != "zoning":
            for batch in chunks(sorted(keys), 100):
                keyed |= layer.ids(f"({where}) AND BLOCK_KEY IN ({','.join(batch)})")
        rows = layer.fetch(candidates | keyed)
        kept = []
        for row in rows:
            geom = polygon(row)
            exact = row["properties"]["OBJECTID"] in keyed
            if name == "zoning" and geom is None:
                raise ValueError("Gazetted candidate lacks polygon")
            limit = 0 if name == "zoning" else RADIUS
            if exact or geom is not None and extent.distance(geom) <= limit:
                kept.append(row)
        layer.receipt.update({"spatialCandidateRows": len(candidates), "exactKeyRows": len(keyed),
                              "uniqueFetchedRows": len(rows), "retainedRows": len(kept)})
        layer.finish()
        return name, kept, layer.receipt

    rows = {"blocks": blocks}
    sources = {"blocks": block_layer.receipt}
    with ThreadPoolExecutor(max_workers=3) as pool:
        for name, records, receipt in pool.map(collect, criteria):
            rows[name] = records
            sources[name] = receipt
    block_layer.finish()
    return {"schemaVersion": 1, "snapshotDate": str(day), "completedSince": str(since),
            "startedUtc": started.isoformat(), "finishedUtc": datetime.now(timezone.utc).isoformat(),
            "crs": "EPSG:7855", "radiusM": RADIUS, "mapBlocksSha256": digest(block_bytes),
            "sources": sources, "records": rows}
