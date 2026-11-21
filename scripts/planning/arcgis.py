"""Read public ACTmapi features in their native metric CRS with count/identity checks."""
import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

BASE = "https://services1.arcgis.com/E5n4f1VY84i0xSjy/ArcGIS/rest/services/ACTGOV_"
LAYERS = {
    "blocks": ("BLOCKS/FeatureServer/0", "OBJECTID,BLOCK_KEY"),
    "zoning": ("TP_LAND_USE_ZONE/FeatureServer/1",
               "OBJECTID,LAND_USE_ZONE_CODE_ID,LAND_USE_POLICY_DESC,CURRENT_LIFECYCLE_STAGE,GAZETTAL_NUMBER,GAZETTAL_DATE"),
    "active": ("ACTIVE_DEVELOPMENT_APPLICATIONS/FeatureServer/0",
               "OBJECTID,DA_NUMBER,BLOCK_KEY,DIVISION,SECTION,BLOCK,LODGEMENT_DATE,APPLICATION_TYPE,SUBCLASS"),
    "completed": ("COMPLETED_DEVELOPMENT_APPLICATIONS/FeatureServer/0",
                  "OBJECTID,DA_NUMBER,BLOCK_KEY,DIVISION,SECTION,BLOCK,LODGEMENT_DATE,DECISION_DATE,DECISION,APPLICATION_TYPE,SUBCLASS"),
}
LICENCE = "https://creativecommons.org/licenses/by/4.0/"


def encoded(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()


def digest(value):
    return hashlib.sha256(value).hexdigest()


def get(url, **params):
    uri = url + "?" + urlencode({"f": "json", **params})
    req = Request(uri, headers={"User-Agent": "CanberraPropertyMap snapshot builder/1.0"})
    for attempt in range(3):
        try:
            with urlopen(req, timeout=45) as response:
                result = json.load(response)
            break
        except (URLError, TimeoutError) as exc:
            if isinstance(exc, HTTPError) and exc.code not in (502, 503, 504):
                raise
            if attempt == 2:
                raise
    if "error" in result:
        raise ValueError(f"ArcGIS rejected {url}: {result['error']}")
    return result


def chunks(seq, size):
    return (seq[i:i + size] for i in range(0, len(seq), size))


def timestamp(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc).isoformat().replace("+00:00", "Z") if ms is not None else None


class Layer:
    def __init__(self, name):
        path, fields = LAYERS[name]
        self.url = BASE + path
        self.fields = fields.split(",")
        self.meta = get(self.url)
        if self.meta["objectIdField"] != "OBJECTID" or set(self.fields) - {f["name"] for f in self.meta["fields"]}:
            raise ValueError(f"Unexpected field schema in {self.url}")
        service = get(self.url.rsplit("/", 1)[0])
        item_url = "https://www.arcgis.com/sharing/rest/content/items/" + service["serviceItemId"]
        item = get(item_url)
        if LICENCE not in item["licenseInfo"]:
            raise ValueError(f"Review changed licence at {item_url}")
        self.receipt = {
            "sourceUrl": self.url, "itemUrl": "https://www.arcgis.com/home/item.html?id=" + item["id"],
            "fields": self.fields, "licence": "CC BY 4.0", "licenceUrl": LICENCE,
            "attribution": "ACTmapi © Australian Capital Territory",
            "termsUrl": "https://www.actmapi.act.gov.au/terms-and-conditions",
            "catalogueModifiedUtc": timestamp(item["modified"]),
            "lastEditUtc": timestamp(self.meta.get("editingInfo", {}).get("lastEditDate")),
            "queries": [], "pages": [],
        }

    def ids(self, where, bounds=None):
        params = {"where": where}
        if bounds is not None:
            params.update(geometry=",".join(map(str, bounds)), inSR="7855", geometryType="esriGeometryEnvelope",
                          spatialRel="esriSpatialRelIntersects")
        query = self.url + "/query"
        count = get(query, **params, returnCountOnly="true")["count"]
        response = get(query, **params, returnIdsOnly="true")
        ids = response.get("objectIds")
        if ids is None and count == 0:
            ids = []
        if not isinstance(ids, list) or count != len(ids) or len(set(ids)) != count or response.get("exceededTransferLimit"):
            raise ValueError(f"Count/ID mismatch for {self.url}")
        self.receipt["queries"].append({"parameters": params, "count": count, "idSha256": digest(encoded(sorted(ids)))})
        return set(ids)

    def fetch(self, ids):
        def page(batch):
            result = get(self.url + "/query", f="geojson", objectIds=",".join(map(str, batch)),
                         outFields=",".join(self.fields), returnGeometry="true", outSR="7855")
            rows = result["features"]
            actual = [row["properties"]["OBJECTID"] for row in rows]
            if set(actual) != set(batch) or len(actual) != len(batch) or result.get("exceededTransferLimit"):
                raise ValueError(f"Incomplete object-ID page for {self.url}")
            if result.get("crs", {}).get("properties", {}).get("name") != "EPSG:7855":
                raise ValueError(f"Expected projected coordinates for {self.url}")
            return [{"properties": {key: row["properties"][key] for key in self.fields},
                     "geometry": row.get("geometry")} for row in rows]

        batches = list(chunks(sorted(ids), min(60, self.meta["maxRecordCount"])))
        all_rows = []
        with ThreadPoolExecutor(max_workers=3) as pool:
            for batch, rows in zip(batches, pool.map(page, batches)):
                self.receipt["pages"].append({"count": len(rows), "idSha256": digest(encoded(batch))})
                all_rows.extend(rows)
        return sorted(all_rows, key=lambda r: r["properties"]["OBJECTID"])

    def finish(self):
        current = get(self.url).get("editingInfo", {}).get("lastEditDate")
        if self.meta.get("editingInfo", {}).get("lastEditDate") != current:
            raise ValueError(f"Source edited during capture: {self.url}")
