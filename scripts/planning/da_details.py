"""Build reviewed DA Finder details from a live capture or a saved evidence file."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import tempfile
from urllib.parse import urlencode

from arcgis import BASE, get

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data/planning"
PUBLIC = ROOT / "public/planning"
LAYER = BASE + "DAFINDER_LIST_VIEW/FeatureServer/0"
ITEM = "5481eb81cb5e4634b20b51ecc72a778a"
ITEM_API = "https://www.arcgis.com/sharing/rest/content/items/" + ITEM
TERMS = "https://www.actmapi.act.gov.au/terms-and-conditions"
FIELDS = ("DA_NUMBER", "AMENDMENT_VERSION", "DA_STAGE", "DECISION", "PROPOSAL_TEXT")
RECEIPT = DATA / "da-details-evidence.json"
REVIEWS = DATA / "da-details-reviewed.json"
OUTPUT = PUBLIC / "da-details.json"
STAGES = {"Decided", "Lodged", "Under Assessment", "On notification"}
DECISIONS = {"Approval Conditional", "Refused", "Withdrawn", None}
CONTACT = re.compile(r"[@<>]|https?://|\b(?:\+?61|0[23478])(?:[ ()-]*\d){8}\b", re.I)


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def encode(data):
    return (json.dumps(data, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()


def save(path, content):
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix="da-details-", delete=False) as out:
        out.write(content)
    Path(out.name).replace(path)


def pinned():
    snapshot = read(PUBLIC / "current.json")["snapshotId"]
    if not re.fullmatch(r"[a-f0-9]{64}", snapshot):
        raise ValueError("Invalid planning release")
    da = read(PUBLIC / "snapshots" / snapshot / "da.json")
    numbers = sorted(da["applications"])
    if da["snapshotId"] != snapshot or not 0 < len(numbers) <= 200 or not all(
        re.fullmatch(r"\d{9}", n, re.ASCII) for n in numbers
    ):
        raise ValueError("Unexpected DA inventory")
    return snapshot, numbers


def capture(snapshot, numbers):
    item = get(ITEM_API)
    if (item["owner"] != "ACTmapi" or item["id"] != ITEM
            or item["url"].lower() != LAYER.rsplit("/", 1)[0].lower()
            or item["accessInformation"] != "Australian Capital Territory"
            or item["licenseInfo"] != f'<p><a target="_blank" rel="noopener noreferrer" href="{TERMS}">{TERMS}</a></p>'):
        raise ValueError("Review the current source item, attribution and reuse terms")

    def edit_stamp():
        return get(LAYER)["editingInfo"]["lastEditDate"]

    stamp = edit_stamp()
    rows = {n: [] for n in numbers}
    for start in range(0, len(numbers), 50):
        batch = numbers[start:start + 50]
        where = "DA_NUMBER IN (" + ",".join(batch) + ")"
        query = LAYER + "/query"
        count = get(query, where=where, returnCountOnly="true")["count"]
        page = get(query, where=where, outFields=",".join(FIELDS), returnGeometry="false")
        if page.get("exceededTransferLimit") or len(page["features"]) != count:
            raise ValueError("Incomplete DA Finder response")
        for feature in page["features"]:
            fields = feature["attributes"]
            number = str(fields["DA_NUMBER"])
            if number not in batch or set(fields) != set(FIELDS):
                raise ValueError("Unexpected DA Finder fields or identifier")
            text = fields["PROPOSAL_TEXT"] or ""
            amendment = fields["AMENDMENT_VERSION"]
            if amendment is not None and not re.fullmatch(r"S\d{2,3}[A-Z]?", amendment):
                raise ValueError("Review amendment identifier")
            if fields["DA_STAGE"] not in STAGES or fields["DECISION"] not in DECISIONS:
                raise ValueError("Review new stage/decision before publishing")
            rows[number].append({
                "proposalSha256": hashlib.sha256(text.encode()).hexdigest(),
                "amendment": amendment, "stage": fields["DA_STAGE"], "decision": fields["DECISION"],
            })
        for number in batch:
            rows[number].sort(key=encode)
    if stamp is None or stamp != edit_stamp():
        raise ValueError("DA Finder changed during capture")
    return {"snapshotId": snapshot, "checkedAt": datetime.now(timezone.utc).date().isoformat(),
            "itemId": ITEM, "lastEditMs": stamp, "rows": rows}


def detail(number, rows, review):
    params = {"where": f"DA_NUMBER={number}", "outFields": ",".join(FIELDS), "returnGeometry": "false", "f": "pjson"}
    result = {"status": "unavailable", "confidence": "unknown", "proposedWorks": None, "sourceQuote": None,
              "questions": [], "stage": None, "decision": None, "sourceUrl": LAYER + "/query?" + urlencode(params)}
    if not rows:
        return result
    if len(rows) != 1:
        result["status"] = "ambiguous"
        return result
    row = rows[0]
    if not review or row["proposalSha256"] != review["proposalSha256"]:
        result["status"] = "unreviewed"
        return result
    if row["stage"] not in STAGES or row["decision"] not in DECISIONS:
        raise ValueError("Unexpected review evidence")
    copy = [review["proposedWorks"], *review["questions"]]
    if any(not isinstance(t, str) or not t or len(t) > 400 or CONTACT.search(t) for t in copy):
        raise ValueError(f"Check editorial copy for DA {number}")
    return {**result, "status": "matched", "confidence": "high", "stage": row["stage"],
            "decision": row["decision"], "proposedWorks": review["proposedWorks"], "questions": review["questions"]}


def build(evidence, snapshot, numbers):
    if evidence["itemId"] != ITEM or evidence["snapshotId"] != snapshot or sorted(evidence["rows"]) != numbers:
        raise ValueError("Evidence belongs to a different planning inventory")
    reviews = read(REVIEWS)
    records = {n: detail(n, evidence["rows"][n], reviews.get(n)) for n in numbers}
    return {"schemaVersion": 1, "snapshotId": snapshot, "checkedAt": evidence["checkedAt"],
            "sourceName": "ACTmapi DA Finder · Australian Capital Territory", "sourceUrl": LAYER,
            "attribution": "ACTGOV_DAFINDER_LIST_VIEW from ACTmapi © Australian Capital Territory. Proposal descriptions are factual summaries.",
            "termsUrl": TERMS, "records": records}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--refresh", action="store_true")
    group.add_argument("--replay", action="store_true")
    group.add_argument("--check", action="store_true")
    args = parser.parse_args()
    snapshot, numbers = pinned()
    evidence = capture(snapshot, numbers) if args.refresh else read(RECEIPT)
    payload = build(evidence, snapshot, numbers)
    content = encode(payload)
    if args.refresh:
        save(RECEIPT, encode(evidence))
    if args.refresh or args.replay:
        save(OUTPUT, content)
    elif OUTPUT.read_bytes() != content:
        raise ValueError("Published details differ from rebuilt evidence")
    counts = Counter(r["status"] for r in payload["records"].values())
    print(f"{len(numbers)} DAs; {sum(map(len, evidence['rows'].values()))} source rows; {dict(counts)}")


if __name__ == "__main__":
    main()

