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

    def test_remitted_decision_and_sibling_amendments(self):
        evidence = da.read(da.RECEIPT)
        number = "202442858"
        review = da.read(da.REVIEWS)[number]
        rows = evidence["rows"][number]
        detail = da.detail(number, list(reversed(rows)), review)
        self.assertEqual(detail["decisionDocument"]["date"], "2026-03-17")
        self.assertEqual((detail["status"], detail["stage"], detail["decision"]),
                         ("matched", "Decided", "Approval Conditional"))
        self.assertIn("1,931", detail["proposedWorks"])
        facts = detail["assessmentFacts"]
        for page, phrase in [(15, "fifth storey"), (15, "68 on-site"), (4, "17 short-term"),
                             (14, "overshadowing"), (1, "condition 2(a)(i)")]:
            self.assertTrue(any(f["page"] == page and phrase in f["text"] for f in facts))
        self.assertIn("S187H-ENDORSEMENT", next(f["documentUrl"] for f in facts if "2(a)(i)" in f["text"]))
        for sibling, other_rows in evidence["rows"].items():
            if sibling != number and len(other_rows) > 1:
                with self.subTest(sibling=sibling):
                    other = da.detail(sibling, other_rows, da.read(da.REVIEWS).get(sibling))
                    self.assertEqual(other["status"], "ambiguous")
                    self.assertIsNone(other["decision"])

    def test_amendment_review_fails_closed_on_source_change(self):
        number = "202442858"
        rows = da.read(da.RECEIPT)["rows"][number]
        review = da.read(da.REVIEWS)[number]
        changes = [rows[:-1], rows[:1], [], rows + [rows[0]]]
        for field, value in (("amendment", "S168H"), ("proposalSha256", "changed"),
                             ("stage", "Under Assessment"), ("decision", None)):
            changes.append([{**rows[0], field: value}, *rows[1:]])
        for changed in changes:
            result = da.detail(number, changed, review)
            self.assertEqual(result["confidence"], "unknown")
            for key in ("proposedWorks", "stage", "decision"):
                self.assertIsNone(result[key])
            self.assertNotIn("assessmentFacts", result)
            self.assertNotIn("decisionDocument", result)
        fact = review["assessmentFacts"][0]
        for field, value in (("documentUrl", "http://example.invalid/document.pdf"),
                             ("page", 0), ("text", "test@example.invalid")):
            with self.subTest(field=field), self.assertRaises(ValueError):
                da.detail(number, rows, {**review, "assessmentFacts": [{**fact, field: value}]})

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
