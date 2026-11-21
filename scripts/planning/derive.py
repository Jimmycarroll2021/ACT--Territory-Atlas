"""Derive parcel-level zone coverage and exact-key/nearby DA joins in EPSG:7855."""
from collections import defaultdict
from datetime import date

from shapely import STRtree, union_all

from arcgis import timestamp
from capture import EXPECTED_BLOCKS, RADIUS, cutoff, key, polygon

AREA_EPSILON = 0.000001  # Floating point overlay noise, in square metres.


def zoning_for(block, candidates):
    by_code = defaultdict(list)
    for row, geom in candidates:
        clipped = block.intersection(geom)
        if clipped.area <= AREA_EPSILON:
            continue
        props = row["properties"]
        code = props["LAND_USE_ZONE_CODE_ID"]
        if not code or props["CURRENT_LIFECYCLE_STAGE"] != "GAZETTED":
            raise ValueError("Invalid gazetted zone input")
        by_code[code].append((props, clipped))

    groups = []
    coverage = []
    for code, pieces in by_code.items():
        merged = union_all([geom for props, geom in pieces])
        area = merged.area
        percent = 100 * area / block.area
        evidence = sorted(({"sourceId": props["OBJECTID"], "areaM2": round(geom.area, 6)}
                           for props, geom in pieces), key=lambda value: value["sourceId"])
        labels = sorted({p["LAND_USE_POLICY_DESC"] for p, _ in pieces if p["LAND_USE_POLICY_DESC"]})
        groups.append({"code": code, "label": " / ".join(labels) or code, "areaM2": round(area, 6),
                       "percent": round(percent, 8), "sliver": area < 1 or percent < 0.1,
                       "sourceIds": [e["sourceId"] for e in evidence], "intersections": evidence})
        coverage.append(merged)
    covered = union_all(coverage).area
    gap = max(0.0, block.area - covered)
    overlap = max(0.0, sum(g.area for g in coverage) - covered)
    return {"zones": sorted(groups, key=lambda x: (-x["areaM2"], x["code"])),
            "blockAreaM2": round(block.area, 6), "gapAreaM2": round(gap, 6),
            "gapPercent": round(100 * gap / block.area, 8), "hasGap": gap > AREA_EPSILON,
            "overlapAreaM2": round(overlap, 6), "hasOverlap": overlap > AREA_EPSILON}


def iso_date(ms):
    return timestamp(ms)[:10] if ms is not None else None


def applications_for(blocks, active, completed, since, day):
    grouped = defaultdict(list)
    exact = defaultdict(set)
    geometries = []
    numbers = []
    for layer, rows in (("active", active), ("completed", completed)):
        for row in rows:
            props = row["properties"]
            number = key(props["DA_NUMBER"])
            if number is None:
                raise ValueError("Missing DA number")
            if layer == "completed":
                decision_date = iso_date(props["DECISION_DATE"])
                if not decision_date or not since <= decision_date <= day:
                    raise ValueError("Completed DA outside snapshot window")
            grouped[number].append((layer, props))
            block_key = key(props["BLOCK_KEY"])
            if block_key in blocks:
                exact[block_key].add(number)
            geom = polygon(row)
            if geom is not None:
                geometries.append(geom)
                numbers.append(number)

    applications = {}
    for number, records in grouped.items():
        # A DA can carry several subclasses and cadastral keys. Source rows stay
        # distinct in the archive even when the frontend shows one DA number.
        def values(field):
            return sorted({props[field] for _, props in records if props.get(field) is not None})
        has_active = any(layer == "active" for layer, _ in records)
        decisions = sorted({(p["DECISION_DATE"], p.get("DECISION") or "") for l, p in records if l == "completed"})
        latest = decisions[-1] if decisions else None
        lodged = values("LODGEMENT_DATE")
        applications[number] = {
            "number": number, "status": "active" if has_active else "completed",
            "decision": latest[1] or None if latest else None,
            "lodgementDate": iso_date(lodged[0]) if lodged else None, "decisionDate": iso_date(latest[0]) if latest else None,
            "types": values("APPLICATION_TYPE"), "subclasses": values("SUBCLASS"), "divisions": values("DIVISION"),
            "blockKeys": [key(v) for v in values("BLOCK_KEY")],
        }
    tree = STRtree(geometries)
    by_block = {}
    for block_key, block in blocks.items():
        distances = {}
        for i in tree.query(block, predicate="dwithin", distance=RADIUS):
            number = numbers[i]
            if number in exact[block_key]:
                continue
            distance = block.distance(geometries[i])
            distances[number] = min(distance, distances.get(number, float("inf")))
        nearby = [{"number": n, "distanceM": round(d, 3)}
                  for n, d in sorted(distances.items(), key=lambda pair: (pair[1], pair[0]))]
        by_block[block_key] = {"onBlock": sorted(exact[block_key]), "nearby": nearby}
    return applications, by_block


def derive(archive):
    rows = archive["records"]
    blocks = {key(r["properties"]["BLOCK_KEY"]): polygon(r) for r in rows["blocks"]}
    if len(blocks) != EXPECTED_BLOCKS or len(rows["blocks"]) != len(blocks) or None in blocks or None in blocks.values():
        raise ValueError("Expected the complete set of registered parcels and geometries")
    day = archive["snapshotDate"]
    since = archive["completedSince"]
    if str(cutoff(date.fromisoformat(day))) != since or archive["crs"] != "EPSG:7855" or archive["radiusM"] != RADIUS:
        raise ValueError("Unexpected snapshot metadata")
    zone_rows = rows["zoning"]
    zone_geoms = [polygon(r) for r in zone_rows]
    tree = STRtree(zone_geoms)
    zoning = {k: zoning_for(block, [(zone_rows[i], zone_geoms[i]) for i in tree.query(block)])
              for k, block in blocks.items()}
    apps, matches = applications_for(blocks, rows["active"], rows["completed"], since, day)
    sources = archive["sources"]
    common = {"schemaVersion": 1, "snapshotDate": day}
    return ({**common, "sourceUrl": sources["zoning"]["sourceUrl"], "byBlock": zoning},
            {**common, "completedSince": since, "radiusM": RADIUS, "applications": apps, "byBlock": matches,
             "sourceUrls": {layer: sources[layer]["sourceUrl"] for layer in ("active", "completed")}})
