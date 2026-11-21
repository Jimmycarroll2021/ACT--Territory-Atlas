# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = ["shapely==2.1.2", "numpy==2.5.5"]
# ///
import gzip
import json
from datetime import date
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from shapely.geometry import box, mapping

from arcgis import Layer
from capture import cutoff
from derive import applications_for, derive, zoning_for
from refresh import DATA, put_atomic, validate_output


def zone(oid, code, geom):
    return ({"properties": {"OBJECTID": oid, "LAND_USE_ZONE_CODE_ID": code,
                            "LAND_USE_POLICY_DESC": code, "CURRENT_LIFECYCLE_STAGE": "GAZETTED"}}, geom)


def application(number, block_key, subclass, geom, **other):
    return {"properties": {"DA_NUMBER": number, "BLOCK_KEY": block_key, "SUBCLASS": subclass,
                           "DIVISION": "BARTON", "APPLICATION_TYPE": "SUBC", **other},
            "geometry": mapping(geom) if geom is not None else None}


class ZoneTests(unittest.TestCase):
    def test_group_union_overlap_gap_and_boundary_only(self):
        result = zoning_for(box(0, 0, 10, 10), [
            zone(10, "A", box(0, 0, 5, 10)), zone(11, "A", box(4, 0, 7, 10)),
            zone(12, "B", box(6, 0, 9, 10)), zone(13, "C", box(10, 0, 11, 10))])
        self.assertEqual([(z["code"], z["percent"]) for z in result["zones"]], [("A", 70), ("B", 30)])
        self.assertEqual(result["zones"][0]["sourceIds"], [10, 11])
        self.assertEqual(result["zones"][0]["intersections"][1]["areaM2"], 30)
        self.assertEqual((result["hasGap"], result["gapAreaM2"]), (True, 10))
        self.assertEqual((result["hasOverlap"], result["overlapAreaM2"]), (True, 10))

    def test_strict_sliver_thresholds_and_no_data(self):
        for size, area, expected in [(10, 0.5, True), (100, 5, True), (10, 1, False), (100, 10, False)]:
            with self.subTest(size=size, area=area):
                z = zoning_for(box(0, 0, size, size), [zone(1, "A", box(0, 0, 1, area))])
                self.assertEqual(z["zones"][0]["sliver"], expected)
        empty = zoning_for(box(0, 0, 10, 10), [])
        self.assertEqual((empty["zones"], empty["gapPercent"]), ([], 100))


class ApplicationTests(unittest.TestCase):
    def test_exact_keys_multi_site_and_nearby_across_suburbs(self):
        blocks = {"1": box(0, 0, 10, 10), "2": box(20, 0, 30, 10)}
        rows = [application(100, 1, "A", None), application(100, 2, "B", box(1000, 0, 1010, 10)),
                application(101, 9, "A", box(510, 0, 515, 10)), application(101, 8, "B", box(520, 0, 530, 10)),
                application(102, 7, "A", box(510.001, 0, 515, 10)),
                application(103, None, "A", box(10, 0, 20, 10))]
        apps, by_block = applications_for(blocks, rows, [], "2021-11-21", "2026-11-21")
        self.assertEqual(by_block["1"]["onBlock"], ["100"])
        self.assertEqual(by_block["2"]["onBlock"], ["100"])
        self.assertEqual(apps["100"]["subclasses"], ["A", "B"])
        self.assertEqual(apps["100"]["blockKeys"], ["1", "2"])
        self.assertEqual(by_block["1"]["nearby"], [{"number": "103", "distanceM": 0}, {"number": "101", "distanceM": 500}])
        self.assertIn({"number": "102", "distanceM": 480.001}, by_block["2"]["nearby"])

    def test_completed_window_and_outcome(self):
        self.assertEqual(cutoff(date(2024, 2, 29)), date(2019, 2, 28))
        date_ms = int((date(2021, 11, 21) - date(1970, 1, 1)).days * 86400000)
        args = {"DECISION_DATE": date_ms, "DECISION": "Refused"}
        record = application(4, 1, "A", None, **args)
        apps, _ = applications_for({"1": box(0, 0, 1, 1)}, [], [record], "2021-11-21", "2026-11-21")
        self.assertEqual((apps["4"]["decision"], apps["4"]["decisionDate"]), ("Refused", "2021-11-21"))
        for invalid in (None, date_ms - 1, date_ms + 10 * 365 * 86400000):
            record["properties"]["DECISION_DATE"] = invalid
            with self.assertRaises(ValueError):
                applications_for({}, [], [record], "2021-11-21", "2026-11-21")


class AcquisitionTests(unittest.TestCase):
    def test_truncated_or_duplicate_id_query_fails(self):
        layer = object.__new__(Layer)
        layer.url, layer.receipt = "https://example.invalid", {"queries": []}
        for ids in ([1], [1, 1], None):
            with patch("arcgis.get", side_effect=[{"count": 2}, {"objectIds": ids}]), self.assertRaises(ValueError):
                layer.ids("1=1")

    def test_truncated_page_fails(self):
        layer = object.__new__(Layer)
        layer.url, layer.fields, layer.meta = "https://example.invalid", ["OBJECTID"], {"maxRecordCount": 2}
        response = {"features": [{"properties": {"OBJECTID": 1}}], "exceededTransferLimit": True}
        with patch("arcgis.get", return_value=response), self.assertRaises(ValueError):
            layer.fetch({1, 2})

    def test_failed_atomic_replace_retains_last_good_bytes(self):
        with TemporaryDirectory() as folder:
            path = Path(folder) / "current.json"
            path.write_bytes(b"old")
            with patch("refresh.os.replace", side_effect=OSError("simulated publishing failure")), self.assertRaises(OSError):
                put_atomic(path, b"new")
            self.assertEqual(path.read_bytes(), b"old")
            self.assertEqual(list(path.parent.iterdir()), [path])


class FrozenSnapshotTests(unittest.TestCase):
    def test_kingston_examples_against_dated_source_geometry(self):
        frozen = DATA / "sources/96fa73950bef6d7d745f995812ccc28f49f7e05735df0ef76df7ab2ef8d0659b.json.gz"
        zoning, da = derive(json.loads(gzip.decompress(frozen.read_bytes())))
        validate_output(zoning, da)
        fixtures = [("12170210027", "CZ1", "202645536", "active"),
                    ("12170260040", "RZ5", "202645034", "completed")]
        for block_key, code, number, status in fixtures:
            with self.subTest(block=block_key):
                zones = zoning["byBlock"][block_key]["zones"]
                self.assertEqual([(z["code"], z["percent"]) for z in zones], [(code, 100)])
                self.assertEqual(da["byBlock"][block_key]["onBlock"], [number])
                self.assertEqual(da["applications"][number]["status"], status)
                self.assertEqual(len(da["applications"][number]["subclasses"]), 4)


if __name__ == "__main__":
    unittest.main(verbosity=2)
