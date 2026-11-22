"""Build an ACTmapi Kingston cadastral hazard overlay snapshot.

Run: uv run --python 3.12 scripts/hazards/refresh.py [--check]
"""
# /// script
# requires-python = ">=3.12"
# dependencies = ["shapely==2.1.2", "pyproj==3.7.2"]
# ///
import argparse
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from pyproj import Transformer
from shapely.geometry import shape
from shapely.ops import transform

ROOT = Path(__file__).resolve().parents[2]
BASE = "https://services1.arcgis.com/E5n4f1VY84i0xSjy/ArcGIS/rest/services/"
LAYERS = {
    "blocks": ("ACTGOV_BLOCKS/FeatureServer/0", ["OBJECTID", "BLOCK_KEY", "DIVISION_NAME", "SECTION_NUMBER", "BLOCK_NUMBER"]),
    "flood": ("ACTGOV_FLOOD_EXTENT/FeatureServer/0", ["OBJECTID"]),
    "bushfire": ("Bushfire_Prone_Area_Details_2026/FeatureServer/0", ["OBJECTID", "Hazard_Category"]),
}
LICENSE = "https://creativecommons.org/licenses/by/4.0/"
MAX_FEATURES = {"blocks": 600, "flood": 3000, "bushfire": 3000}
PAGE_SIZE = 50


def canonical(obj):
    return (json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def get(url, **parameters):
    uri = url + "?" + urlencode({"f": "json", **parameters})
    with urlopen(Request(uri, headers={"User-Agent": "CanberraPropertyMap hazards snapshot/1.0"}), timeout=35) as response:
        data = json.load(response)
    if "error" in data:
        raise ValueError(f"ArcGIS error at {url}: {data['error']}")
    return data


def iso(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z") if ms else None


def source(name):
    suffix, fields = LAYERS[name]
    url = BASE + suffix
    metadata = get(url)
    if metadata.get("geometryType") != "esriGeometryPolygon" or metadata.get("objectIdField") != "OBJECTID":
        raise ValueError(f"Unexpected geometry/ID schema: {name}")
    if metadata.get("extent", {}).get("spatialReference", {}).get("wkid") != 7855:
        raise ValueError(f"Unexpected source CRS: {name}")
    if set(fields) - {field["name"] for field in metadata["fields"]}:
        raise ValueError(f"Missing source fields: {name}")
    service = get(url.rsplit("/", 1)[0])
    item = get("https://www.arcgis.com/sharing/rest/content/items/" + service["serviceItemId"])
    if LICENSE not in item.get("licenseInfo", ""):
        raise ValueError(f"Review changed licence: {name}")
    return {"url": url, "metadata": metadata, "item": item, "fields": fields, "queries": []}


def query(layer, where, envelope=None, limit=3000):
    params = {"where": where}
    if envelope:
        params.update(geometry=",".join(str(round(v, 3)) for v in envelope), geometryType="esriGeometryEnvelope", inSR=7855, spatialRel="esriSpatialRelIntersects")
    query_url = layer["url"] + "/query"
    count = get(query_url, **params, returnCountOnly="true")["count"]
    raw_ids = get(query_url, **params, returnIdsOnly="true")
    ids = raw_ids.get("objectIds") or []
    if count != len(ids) or len(set(ids)) != count or raw_ids.get("exceededTransferLimit") or count > limit:
        raise ValueError(f"Incomplete or excessive source inventory at {query_url}: {count}/{len(ids)}")
    rows = []
    for start in range(0, len(ids), PAGE_SIZE):
        batch = sorted(ids)[start:start + PAGE_SIZE]
        page = get(query_url, objectIds=",".join(map(str, batch)), outFields=",".join(layer["fields"]), outSR=7855, returnGeometry="true")
        actual = [f["attributes"]["OBJECTID"] for f in page.get("features", [])]
        if sorted(actual) != batch or page.get("exceededTransferLimit"):
            raise ValueError(f"Incomplete feature page at {query_url}")
        for feature in page["features"]:
            geometry = feature.get("geometry")
            if not geometry or "rings" not in geometry or geometry.get("spatialReference", {}).get("wkid", 7855) != 7855:
                raise ValueError(f"Missing or wrong-CRS geometry at {query_url}")
            rows.append(feature)
    layer["queries"].append({"where": where, "envelopeEpsg7855": envelope, "count": count, "idSha256": sha(canonical(sorted(ids)))})
    return sorted(rows, key=lambda f: f["attributes"]["OBJECTID"])


def esri_polygon(geometry, clip_bounds=None):
    # ArcGIS ring orientation: exteriors clockwise, holes counter-clockwise.
    from shapely.geometry import Polygon
    from shapely.ops import unary_union, clip_by_rect
    exteriors, holes = [], []
    for ring in geometry["rings"]:
        signed = sum((ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]) for i in range(len(ring) - 1))
        # A hazard feature can have a territory-wide multipart geometry. Clip
        # each constituent ring before GEOS unions it with hundreds of peers.
        if clip_bounds and (max(p[0] for p in ring) < clip_bounds[0] or min(p[0] for p in ring) > clip_bounds[2]
                            or max(p[1] for p in ring) < clip_bounds[1] or min(p[1] for p in ring) > clip_bounds[3]):
            continue
        polygon = Polygon(ring)
        if clip_bounds:
            polygon = clip_by_rect(polygon, *clip_bounds)
        if not polygon.is_empty:
            (exteriors if signed < 0 else holes).append(polygon)
    if not exteriors:
        if clip_bounds:
            return Polygon()
        raise ValueError("Source polygon has no exterior ring")
    polygon = unary_union(exteriors)
    for hole in holes:
        polygon = polygon.difference(hole)
    if not polygon.is_valid:
        polygon = polygon.buffer(0)
    if polygon.is_empty or not polygon.is_valid:
        raise ValueError("Invalid source polygon")
    return polygon


def local_blocks():
    path = ROOT / "public/geo/kingston-blocks.geojson"
    raw = path.read_bytes()
    features = json.loads(raw)["features"]
    transformer = Transformer.from_crs(4326, 7855, always_xy=True).transform
    result = {}
    for feature in features:
        key = str(feature["properties"]["BLOCK_KEY"])
        polygon = transform(transformer, shape(feature["geometry"]))
        if not polygon.is_valid:
            polygon = polygon.buffer(0)
        if key in result or polygon.is_empty or polygon.area <= 0:
            raise ValueError("Duplicate or invalid local block")
        result[key] = polygon
    if len(result) != 375:
        raise ValueError(f"Expected 375 local blocks, got {len(result)}")
    return result, sha(raw)


def classify(block, source_features):
    area_parts, contacts, ids, categories = [], [], [], set()
    for polygon, attributes in source_features:
        if not block.intersects(polygon):
            continue
        intersection = block.intersection(polygon)
        if intersection.area > 1e-6:
            area_parts.append(intersection)
            ids.append(attributes["OBJECTID"])
            if attributes.get("Hazard_Category"):
                categories.add(attributes["Hazard_Category"])
        elif block.touches(polygon):
            contacts.append(attributes["OBJECTID"])
    from shapely.ops import unary_union
    area = unary_union(area_parts).area if area_parts else 0.0
    return {"status": "intersection" if area > 1e-6 else "no mapped intersection", "areaM2": round(area, 3),
            "boundaryContact": bool(contacts), "sourceIds": sorted(set(ids)), "boundarySourceIds": sorted(set(contacts)),
            "categories": sorted(categories)}


def build():
    local, local_hash = local_blocks()
    print("Validated bundled block geometry", flush=True)
    layers = {name: source(name) for name in LAYERS}
    blocks = query(layers["blocks"], "DIVISION_NAME='KINGSTON' AND CURRENT_LIFECYCLE_STAGE='REGISTERED'", limit=MAX_FEATURES["blocks"])
    print(f"Fetched {len(blocks)} registered blocks", flush=True)
    native = {str(f["attributes"]["BLOCK_KEY"]): esri_polygon(f["geometry"]) for f in blocks}
    if set(native) != set(local) or len(native) != len(blocks):
        raise ValueError("Current registered block inventory differs from bundled map")
    for key in native:
        if native[key].hausdorff_distance(local[key]) > 0.75 or abs(native[key].area - local[key].area) > max(1, native[key].area * .005):
            raise ValueError(f"Current block geometry differs from bundled map: {key}")
    bounds = [min(g.bounds[0] for g in native.values()) - 1, min(g.bounds[1] for g in native.values()) - 1,
              max(g.bounds[2] for g in native.values()) + 1, max(g.bounds[3] for g in native.values()) + 1]
    features = {name: query(layers[name], "1=1", bounds, MAX_FEATURES[name]) for name in ("flood", "bushfire")}
    print("Fetched hazard features: " + ", ".join(f"{name}={len(rows)}" for name, rows in features.items()), flush=True)
    prepared = {name: [(esri_polygon(f["geometry"], bounds), f["attributes"]) for f in features[name]] for name in features}
    print("Validated hazard polygon geometry", flush=True)
    # The feature count and IDs are checked against the same spatial query, then exact intersections are local.
    for name in layers:
        fresh = get(layers[name]["url"])
        if fresh.get("editingInfo", {}).get("lastEditDate") != layers[name]["metadata"].get("editingInfo", {}).get("lastEditDate"):
            raise ValueError(f"Source changed during capture: {name}")
    by_block = {key: {name: classify(native[key], prepared[name]) for name in ("flood", "bushfire")} for key in sorted(native, key=int)}
    for row in by_block.values():
        row["flood"].pop("categories")
    sources = {}
    for name in ("flood", "bushfire"):
        layer = layers[name]
        sources[name] = {"title": layer["item"]["title"], "sourceUrl": layer["url"],
                         "catalogueUrl": "https://www.arcgis.com/home/item.html?id=" + layer["item"]["id"],
                         "catalogueModifiedAtUtc": iso(layer["item"].get("modified")),
                         "sourceEditedAtUtc": iso(layer["metadata"].get("editingInfo", {}).get("dataLastEditDate")),
                         "edition": "2026" if name == "bushfire" else "1% AEP model",
                         "licence": "CC BY 4.0 (Australian Capital Territory)", "licenceUrl": LICENSE,
                         "attribution": "ACTmapi (c) Australian Capital Territory",
                         "coverage": "Published mapped source polygons queried over the Kingston block envelope; absence of an intersection does not establish absence of hazard.",
                         "query": layer["queries"][0]}
    data = {"schemaVersion": 1, "retrievedAtUtc": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "coordinateReferenceSystem": "EPSG:7855 (GDA2020 / MGA zone 55; metres)",
            "blockGeojsonSha256": local_hash, "blockCount": len(by_block), "sources": sources, "byBlock": by_block,
            "interpretation": "Cadastral polygon screening only. Intersections and boundary contact do not establish dwelling exposure, flood depth, bushfire attack level, insurance, or planning status."}
    return data


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="Validate saved snapshot against bundled block map, without network")
    args = parser.parse_args()
    output = ROOT / "public/hazards/kingston.json"
    if args.check:
        saved = json.loads(output.read_bytes())
        blocks, digest = local_blocks()
        if saved["blockGeojsonSha256"] != digest or set(saved["byBlock"]) != set(blocks):
            raise ValueError("Saved snapshot does not match bundled block map")
        for key, row in saved["byBlock"].items():
            for name in ("flood", "bushfire"):
                value = row[name]
                if value["status"] not in ("intersection", "no mapped intersection", "unknown") or value["areaM2"] < 0 or value["areaM2"] > blocks[key].area + 1:
                    raise ValueError(f"Invalid saved classification: {key}/{name}")
        print(f"Checked {len(blocks)} block records; sha256={sha(output.read_bytes())}")
        return
    data = build()
    encoded = canonical(data)
    output.parent.mkdir(parents=True, exist_ok=True)
    temp = output.with_suffix(".tmp")
    temp.write_bytes(encoded)
    os.replace(temp, output)
    evidence = {"outputSha256": sha(encoded), "blockGeojsonSha256": data["blockGeojsonSha256"],
                "retrievedAtUtc": data["retrievedAtUtc"], "sources": data["sources"]}
    evidence_path = ROOT / "data/hazards/manifest.json"
    evidence_path.parent.mkdir(parents=True, exist_ok=True)
    evidence_path.write_bytes(canonical(evidence))
    print(f"Wrote {len(data['byBlock'])} block records; sha256={sha(encoded)}")


if __name__ == "__main__":
    main()
