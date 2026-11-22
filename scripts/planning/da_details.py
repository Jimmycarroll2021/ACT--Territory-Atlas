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
RECONCILIATION = DATA / "da-reconciliation.json"
HOLDS = DATA / "da-details-holds.json"
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


def check_copy(number, texts):
    if any(not isinstance(t, str) or not t or len(t) > 400 or CONTACT.search(t) for t in texts):
        raise ValueError(f"Check editorial copy for DA {number}")


def reviewed_documents(number, review):
    document = review["decisionDocument"]
    facts = review["assessmentFacts"]
    if (set(document) != {"title", "url", "date"} or not facts
            or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", document["date"])):
        raise ValueError("Invalid decision document")
    check_copy(number, [document["title"]])
    urls = [document["url"]]
    for fact in facts:
        if (set(fact) != {"text", "documentTitle", "page", "documentUrl"}
                or type(fact["page"]) is not int or fact["page"] < 1):
            raise ValueError("Invalid assessment fact")
        check_copy(number, [fact["text"], fact["documentTitle"]])
        urls.append(fact["documentUrl"])
    prefix = f"https://dafinder.blob.core.windows.net/dadocuments/DOCs/NOTICEOFDECISION-{number}-"
    if not all(url.startswith(prefix) and re.fullmatch(r"[A-Z0-9-]+\.pdf", url[len(prefix):]) for url in urls):
        raise ValueError("Unexpected official decision URL")
    return {"decisionDocument": document, "assessmentFacts": facts}


def detail(number, rows, review):
    params = {"where": f"DA_NUMBER={number}", "outFields": ",".join(FIELDS), "returnGeometry": "false", "f": "pjson"}
    result = {"status": "unavailable", "confidence": "unknown", "proposedWorks": None, "sourceQuote": None,
              "questions": [], "stage": None, "decision": None, "sourceUrl": LAYER + "/query?" + urlencode(params)}
    if not rows:
        return result
    if len(rows) > 1 or (review and "rowSetSha256" in review):
        signature = hashlib.sha256(encode(sorted(rows, key=encode))).hexdigest()
        if not review or signature != review.get("rowSetSha256"):
            result["status"] = "ambiguous" if len(rows) > 1 else "unreviewed"
            return result
        result.update(reviewed_documents(number, review))
        stage, decision = review["stage"], review["decision"]
    else:
        row = rows[0]
        if not review or row["proposalSha256"] != review["proposalSha256"]:
            result["status"] = "unreviewed"
            return result
        stage, decision = row["stage"], row["decision"]
    if stage not in STAGES or decision not in DECISIONS:
        raise ValueError("Unexpected review evidence")
    check_copy(number, [review["proposedWorks"], *review["questions"]])
    return {**result, "status": "matched", "confidence": "high", "stage": stage,
            "decision": decision, "proposedWorks": review["proposedWorks"], "questions": review["questions"]}


def build(evidence, snapshot, numbers):
    if evidence["itemId"] != ITEM or evidence["snapshotId"] != snapshot or sorted(evidence["rows"]) != numbers:
        raise ValueError("Evidence belongs to a different planning inventory")
    reviews = read(REVIEWS)
    records = {n: detail(n, evidence["rows"][n], reviews.get(n)) for n in numbers}
    return {"schemaVersion": 1, "snapshotId": snapshot, "checkedAt": evidence["checkedAt"],
            "sourceName": "ACTmapi DA Finder · Australian Capital Territory", "sourceUrl": LAYER,
            "attribution": "ACTGOV_DAFINDER_LIST_VIEW from ACTmapi © Australian Capital Territory. Proposal descriptions are factual summaries.",
            "termsUrl": TERMS, "records": records}


def reconcile(evidence, payload, snapshot, numbers):
    """Record the disposition of every pinned number without selecting an amendment."""
    holds = read(HOLDS)
    if set(holds) - set(numbers):
        raise ValueError("Hold belongs to a different planning inventory")
    records = {}
    for number in numbers:
        rows = evidence["rows"][number]
        published = payload["records"][number]
        status = published["status"]
        if status == "matched":
            disposition = "reviewed_summary"
            reason = "Proposal summary is pinned to reviewed source evidence."
        elif status == "unavailable":
            disposition = "no_finder_row"
            reason = "No exact DA number match was returned by DA Finder."
        elif status == "ambiguous":
            disposition = "multiple_rows_pending_review"
            reason = "Multiple rows exist; no amendment or decision is selected without document review."
        else:
            disposition = "source_pending_review"
            reason = holds.get(number, "Source proposal has not been reviewed for publication.")
        if number in holds and status != "unreviewed":
            raise ValueError(f"Stale review hold for DA {number}")
        check_copy(number, [reason])
        records[number] = {
            "reviewDisposition": disposition,
            "reason": reason,
            "sourceRowCount": len(rows),
            "sourceRows": [{"amendment": r["amendment"], "stage": r["stage"],
                            "decision": r["decision"], "proposalSha256": r["proposalSha256"]}
                           for r in rows],
            "publishedStatus": status,
            "publishedStage": published["stage"],
            "publishedDecision": published["decision"],
            "sourceUrl": published["sourceUrl"],
        }
    return {"schemaVersion": 1, "snapshotId": snapshot, "checkedAt": evidence["checkedAt"],
            "sourceName": payload["sourceName"], "sourceUrl": LAYER, "records": records}


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
    ledger = encode(reconcile(evidence, payload, snapshot, numbers))
    if args.refresh:
        save(RECEIPT, encode(evidence))
    if args.refresh or args.replay:
        save(OUTPUT, content)
        save(RECONCILIATION, ledger)
    elif OUTPUT.read_bytes() != content:
        raise ValueError("Published details differ from rebuilt evidence")
    elif RECONCILIATION.read_bytes() != ledger:
        raise ValueError("Reconciliation differs from rebuilt evidence")
    counts = Counter(r["status"] for r in payload["records"].values())
    print(f"{len(numbers)} DAs; {sum(map(len, evidence['rows'].values()))} source rows; {dict(counts)}")


if __name__ == "__main__":
    main()

