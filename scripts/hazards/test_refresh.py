"""Offline geometry and saved snapshot checks for the hazard builder.

Run: uv run --python 3.12 scripts/hazards/test_refresh.py
"""
# /// script
# requires-python = ">=3.12"
# dependencies = ["shapely==2.1.2", "pyproj==3.7.2"]
# ///
import json
import unittest
from pathlib import Path

from shapely.geometry import Polygon

from refresh import ROOT, classify, esri_polygon, local_blocks, sha


class GeometryTests(unittest.TestCase):
    def test_area_and_boundary_are_distinct(self):
        block = Polygon([(0, 0), (10, 0), (10, 10), (0, 10)])
        interior = (Polygon([(5, 5), (12, 5), (12, 12), (5, 12)]), {"OBJECTID": 1, "Hazard_Category": "A"})
        touching = (Polygon([(10, 0), (12, 0), (12, 2), (10, 2)]), {"OBJECTID": 2, "Hazard_Category": "B"})
        hit = classify(block, [interior, touching])
        self.assertEqual(hit["status"], "intersection")
        self.assertAlmostEqual(hit["areaM2"], 25)
        self.assertEqual(hit["sourceIds"], [1])
        self.assertEqual(hit["boundarySourceIds"], [2])
        self.assertEqual(hit["categories"], ["A"])
        boundary_only = classify(block, [touching])
        self.assertEqual(boundary_only["status"], "no mapped intersection")
        self.assertTrue(boundary_only["boundaryContact"])
        self.assertEqual(classify(block, [] )["status"], "no mapped intersection")

    def test_arcgis_ring_and_hole_clipping(self):
        # Clockwise exterior, anticlockwise hole. Clip to a small screen region.
        exterior = [[0, 0], [0, 20], [20, 20], [20, 0], [0, 0]]
        hole = [[4, 4], [16, 4], [16, 16], [4, 16], [4, 4]]
        polygon = esri_polygon({"rings": [exterior, hole]}, (2, 2, 8, 8))
        self.assertAlmostEqual(polygon.area, 20)

    def test_saved_snapshot_matches_map_and_manifest(self):
        path = ROOT / "public/hazards/kingston.json"
        data = json.loads(path.read_bytes())
        blocks, digest = local_blocks()
        self.assertEqual(data["blockGeojsonSha256"], digest)
        self.assertEqual(set(data["byBlock"]), set(blocks))
        manifest = json.loads((ROOT / "data/hazards/manifest.json").read_bytes())
        self.assertEqual(manifest["outputSha256"], sha(path.read_bytes()))
        for key, row in data["byBlock"].items():
            for name in ("flood", "bushfire"):
                entry = row[name]
                self.assertLessEqual(entry["areaM2"], blocks[key].area + 1)
                self.assertEqual(entry["status"] == "intersection", entry["areaM2"] > 0)


if __name__ == "__main__":
    unittest.main()
