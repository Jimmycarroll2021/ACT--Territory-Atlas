"""Run from the repository root with python -B scripts/planning/da_details.test.py."""
import unittest
from urllib.parse import parse_qs, urlparse

import da_details as da


class DetailsTests(unittest.TestCase):
    def setUp(self):
        self.number = "202645536"
        self.review = da.read(da.REVIEWS)[self.number]
        self.row = da.read(da.RECEIPT)["rows"][self.number][0]

    def test_lease_and_courtyard_descriptions(self):
        snapshot, numbers = da.pinned()
        dataset = da.build(da.read(da.RECEIPT), snapshot, numbers)
        records = dataset["records"]
        lease = records[self.number]
        self.assertEqual(lease["status"], "matched")
        for phrase in ("ground floor", "health facility", "no construction"):
            self.assertIn(phrase, lease["proposedWorks"])
        wall = records["202645034"]
        self.assertEqual(wall["status"], "matched")
        for phrase in ("wall", "gate", "garden bed", "landscapes"):
            self.assertIn(phrase, wall["proposedWorks"])
        self.assertEqual(da.encode(dataset), da.OUTPUT.read_bytes())

    def test_unavailable_ambiguous_and_changed_text(self):
        for status, rows in [
            ("unavailable", []), ("ambiguous", [self.row, self.row]),
            ("unreviewed", [{**self.row, "proposalSha256": "changed"}]),
        ]:
            with self.subTest(status=status):
                r = da.detail(self.number, rows, self.review)
                self.assertEqual(r["status"], status)
                self.assertEqual(r["confidence"], "unknown")
                self.assertEqual(r["questions"], [])
                self.assertTrue(all(r[k] is None for k in ("proposedWorks", "sourceQuote", "stage", "decision")))

    def test_private_fields_and_copy(self):
        row = {**self.row, "APPLICANT_NAME": "test-only marker", "COMMENTS": "private marker"}
        detail = da.detail(self.number, [row], self.review)
        query = parse_qs(urlparse(detail["sourceUrl"]).query)
        self.assertEqual(query["where"], ["DA_NUMBER=" + self.number])
        self.assertEqual(query["outFields"][0].split(","), list(da.FIELDS))
        self.assertIsNone(detail["sourceQuote"])
        self.assertNotIn("marker", str(detail))
        for text in ("test@example.invalid", "<script>", "0412 345 678"):
            with self.subTest(text=text), self.assertRaisesRegex(ValueError, "editorial copy"):
                da.detail(self.number, [row], {**self.review, "questions": [text]})

    def test_snapshot_identity(self):
        snapshot, numbers = da.pinned()
        evidence = da.read(da.RECEIPT)
        for invalid in ({**evidence, "snapshotId": "other"}, {**evidence, "rows": {}}):
            with self.assertRaisesRegex(ValueError, "different planning inventory"):
                da.build(invalid, snapshot, numbers)


if __name__ == "__main__":
    unittest.main()
