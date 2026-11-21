# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = ["shapely==2.1.2", "numpy==2.5.5"]
# ///
"""Refresh from ACTmapi, replay a sanitized source archive, or verify the current build."""
import argparse
from collections import Counter
from contextlib import contextmanager
import gzip
import json
import os
from pathlib import Path
import tempfile

from arcgis import LAYERS, digest, encoded
from capture import capture, key
from derive import derive

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data/planning"
PUBLIC = ROOT / "public/planning"
BLOCK_FILE = ROOT / "public/geo/kingston-blocks.geojson"


@contextmanager
def publish_lock(directory):
    # Kernel-held lock is released if the builder exits unexpectedly.
    with (directory / ".publish.lock").open("a+b") as handle:
        handle.seek(0)
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def put_atomic(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_file() and path.read_bytes() == content:
        return
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".tmp-", delete=False) as tmp:
        name = Path(tmp.name)
        try:
            tmp.write(content)
            tmp.flush()
            os.fsync(tmp.fileno())
        except BaseException:
            tmp.close()
            name.unlink(missing_ok=True)
            raise
    try:
        os.replace(name, path)
    finally:
        name.unlink(missing_ok=True)


def validate_archive(archive, block_bytes):
    if digest(block_bytes) != archive["mapBlocksSha256"]:
        raise ValueError("Source archive belongs to a different map block file")
    blocks = {key(r["properties"]["BLOCK_KEY"]) for r in archive["records"]["blocks"]}
    if blocks != {key(f["properties"]["BLOCK_KEY"]) for f in json.loads(block_bytes)["features"]}:
        raise ValueError("Source archive block keys differ from map keys")
    for layer, (path, fields) in LAYERS.items():
        records = archive["records"][layer]
        receipt = archive["sources"][layer]
        ids = {r["properties"]["OBJECTID"] for r in records}
        if len(ids) != len(records) or len(records) != receipt.get("retainedRows", receipt["queries"][0]["count"]):
            raise ValueError(f"Invalid retained row count for {layer}")
        if sum(p["count"] for p in receipt["pages"]) != receipt.get("uniqueFetchedRows", len(records)):
            raise ValueError(f"Incomplete page receipt in {layer}")
        for row in records:
            if set(row) != {"properties", "geometry"} or set(row["properties"]) != set(fields.split(",")):
                raise ValueError(f"Unexpected attributes in archived {layer} record")


def validate_output(zoning, da):
    if zoning["byBlock"].keys() != da["byBlock"].keys():
        raise ValueError("Incomplete DA or zoning coverage")
    for k, value in da["byBlock"].items():
        nearby = {r["number"] for r in value["nearby"]}
        exact = set(value["onBlock"])
        if len(nearby) != len(value["nearby"]) or len(exact) != len(value["onBlock"]) or exact & nearby:
            raise ValueError(f"Duplicate display rows on {k}")
        if (exact | nearby) - da["applications"].keys() or any(k not in da["applications"][n]["blockKeys"] for n in exact):
            raise ValueError(f"Invalid DA/block joins on {k}")
        if any(not 0 <= r["distanceM"] <= da["radiusM"] for r in value["nearby"]):
            raise ValueError(f"DA outside radius on {k}")


def artifacts(archive, archive_bytes):
    validate_archive(archive, BLOCK_FILE.read_bytes())
    zoning, da = derive(archive)
    validate_output(zoning, da)
    snapshot_id = digest(encoded([digest(encoded(archive)), digest(encoded(zoning)), digest(encoded(da))]))
    release = "snapshots/" + snapshot_id
    payloads = {name: encoded({**obj, "snapshotId": snapshot_id}) for name, obj in (("zoning", zoning), ("da", da))}
    pointer = {"schemaVersion": 1, "snapshotId": snapshot_id,
               **{name + "Url": f"/planning/{release}/{name}.json" for name in payloads}}
    source_path = f"data/planning/sources/{snapshot_id}.json.gz"
    zones = list(zoning["byBlock"].values())
    manifest = {key: value for key, value in archive.items() if key != "records"}
    manifest.update({
        "snapshotId": snapshot_id, "sourceArchive": source_path, "sourceArchiveSha256": digest(archive_bytes),
        "publicFiles": {name: {"path": pointer[name + "Url"], "sha256": digest(content), "bytes": len(content)}
                        for name, content in payloads.items()},
        "zoneSummary": {"blocks": len(zones), "withCoverage": sum(bool(b["zones"]) for b in zones),
                        "withGap": sum(b["hasGap"] for b in zones), "withOverlap": sum(b["hasOverlap"] for b in zones),
                        "multiMaterialZone": sum(sum(not z["sliver"] for z in b["zones"]) > 1 for b in zones),
                        "sliverGroups": sum(z["sliver"] for b in zones for z in b["zones"])},
        "applicationSummary": dict(Counter(app["status"] for app in da["applications"].values())),
    })
    files = {ROOT / source_path: archive_bytes}
    for name, content in payloads.items():
        files[PUBLIC / release / (name + ".json")] = content
        files[PUBLIC / (name + ".json")] = content
    files[DATA / "manifest.json"] = (json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode()
    # Readers resolve one pointer, then both immutable files. Switching this last
    # keeps the previous release available even across an interrupted publish.
    files[PUBLIC / "current.json"] = encoded(pointer)
    return files, manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--replay", type=Path, help="publish from an existing .json.gz capture")
    action.add_argument("--check", action="store_true", help="rebuild in memory and verify all committed bytes")
    args = parser.parse_args()
    replay = args.replay
    if args.check:
        replay = ROOT / json.loads((DATA / "manifest.json").read_text(encoding="utf8"))["sourceArchive"]
    if replay:
        archive_bytes = replay.read_bytes()
        archive = json.loads(gzip.decompress(archive_bytes))
    else:
        archive = capture(BLOCK_FILE)
        archive_bytes = gzip.compress(encoded(archive), mtime=0)
    files, manifest = artifacts(archive, archive_bytes)
    if args.check:
        for path, expected in files.items():
            if path.read_bytes() != expected:
                raise ValueError(f"Snapshot differs from offline rebuild: {path}")
    else:
        DATA.mkdir(parents=True, exist_ok=True)
        with publish_lock(DATA):
            for path, content in files.items():
                put_atomic(path, content)
    print(json.dumps({k: manifest[k] for k in ("snapshotId", "snapshotDate", "zoneSummary", "applicationSummary")}))


if __name__ == "__main__":
    main()
