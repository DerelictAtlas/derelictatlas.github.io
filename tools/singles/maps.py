"""MAPS1 (2026-11-06, SITE): the hourly singles job adds the map of every system that is in a map list (views/map-lists.txt)
but has no entry in the map bundle views/top100.json(.gz) -- the visitor singles that broke into a top-100 list. Until
now only the PC publish made those maps, so the viewer scanned and drew such a system on every visit.

  python3 -I tools/singles/maps.py --repo . [--work DIR] [--max N] [--minutes M] [--deadline EPOCH] [--message FILE]

The maps are the ones the PC publish makes: tools/singles/map_many.cjs scans the system with the site's W29 wasm
(derelict on), packs it with the site's own model.js pack() (byte identical to tools/derelict_view.py pack()), using the
piece-table ids of the published bundle (a system that needs a scene the table lacks is skipped: the table also holds the
wall shapes, which this job does not have). An entry is added to "s" (view), to "k" (its map-list bits, as map-lists.txt)
and, when the engine mapped it, to views/top100-loot.json (the Quick Run per-container values). "s" and "k" are kept
sorted by address, JSON compact, gzip level 9 with mtime 0, exactly as the PC publish writes them (checked: the same
bytes come out when nothing is added).

Safety (the singles data of the hour is committed whatever happens here):
  * additive only: no entry is removed or changed; the 11 bundle entries of systems in no list stay;
  * the new files are built and validated in memory first (parse, every old entry equal, .json == gunzip(.json.gz),
    the piece table unchanged), then written through temp files next to the real ones and renamed; any error before the
    rename leaves every file as it was, a failure while renaming puts the old bytes back;
  * nothing missing / nothing made = no file is touched (a no-op run stays a no-op);
  * at most --max maps per run (default 300) and --minutes (default 6) of scanning, never past --deadline; the rest
    is made by the next run (the missing set is recomputed every run, so a failed run heals itself).
Exit code is always 0 for a failure of the maps (they are printed as "maps: ..."); 2 only for bad arguments.
Python 3 standard library only (plus Node for map_many.cjs).
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
MAP_FILE = Path("views") / "map-lists.txt"
BUNDLE_GZ = Path("views") / "top100.json.gz"
BUNDLE_JSON = Path("views") / "top100.json"
LOOT = Path("views") / "top100-loot.json"
HELPER = HERE / "map_many.cjs"
ADDR = re.compile(r"^[0-9A-F]{16}$")
VIEW_KEYS = ["v", "a", "s", "p", "e", "r", "c", "i"]


def dumps(doc) -> bytes:
    return json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def listed(repo: Path):
    """[(ADDRESS16, bits)] of views/map-lists.txt in file order; None when the file is missing."""
    p = repo / MAP_FILE
    if not p.exists():
        return None
    out = []
    for line in p.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        a, _, bits = line.partition(" ")
        a = a.strip().upper()
        if ADDR.match(a) and bits.strip().isdigit():
            out.append((a, int(bits)))
    return out


def read_bundle(repo: Path):
    """(doc, gz bytes, json bytes) when both bundle files exist, parse, and agree; else raises."""
    gz = (repo / BUNDLE_GZ).read_bytes()
    plain = (repo / BUNDLE_JSON).read_bytes()
    if gzip.decompress(gz) != plain:
        raise ValueError("views/top100.json and views/top100.json.gz differ")
    doc = json.loads(plain.decode("utf-8"))
    if not (isinstance(doc, dict) and isinstance(doc.get("s"), dict) and isinstance(doc.get("t"), dict)
            and isinstance(doc.get("k"), dict) and isinstance(doc["t"].get("n"), list)):
        raise ValueError("bundle has no s / t / k")
    return doc, gz, plain


def good_view(view, address, table_len, version):
    if not isinstance(view, dict) or view.get("a") != address or view.get("v") != version:
        return False
    keys = list(view)
    if keys != VIEW_KEYS and keys != VIEW_KEYS + ["x"]:
        return False
    ids = view["i"][0] if isinstance(view.get("i"), list) and view["i"] else []
    return all(isinstance(n, int) and 0 <= n < table_len for n in ids) and bool(view["r"]) and bool(view["c"])


def good_loot(loot, view):
    if not isinstance(loot, dict) or not isinstance(loot.get("cv"), list) or len(loot["cv"]) != 2:
        return False
    if len(loot["cv"][0]) != len(view["c"][0]) or len(loot["cv"][1]) != len(view["c"][0]):
        return False
    if "xv" in loot:
        x = view.get("x")
        return bool(x) and len(loot["xv"]) == 2 and len(loot["xv"][0]) == len(x[0]) == len(loot["xv"][1])
    return "x" not in view or not view["x"][0]


def run_node(repo, work, addrs, table_file, max_attempts, deadline, node):
    """map_many.cjs results {address: {"view", "loot"}} + {address: error}; raises on any abnormal end."""
    work.mkdir(parents=True, exist_ok=True)
    af = work / "map-addresses.txt"
    af.write_text("\n".join(addrs) + "\n", encoding="utf-8")
    cmd = [node, str(HELPER), str(repo / "scan"), str(af), str(table_file), "--max", str(max_attempts),
           "--deadline", str(int(deadline * 1000))]
    budget = max(60.0, deadline - time.time() + 120.0)        # the helper stops itself at the deadline; this is the backstop
    cp = subprocess.run(cmd, capture_output=True, timeout=budget)
    if cp.returncode != 0:
        raise RuntimeError(f"map_many.cjs exit {cp.returncode}: {cp.stderr.decode('utf-8', 'replace')[-200:]}")
    made, errors, last, version = {}, {}, None, None
    for line in cp.stdout.decode("utf-8").splitlines():
        o = json.loads(line)
        if "w29_version" in o:
            version = o["w29_version"]
        elif "done" in o:
            last = o
        elif "view" in o:
            made[o["address"]] = {"view": o["view"], "loot": o.get("loot")}
        elif "error" in o:
            errors[o["address"]] = o["error"]
    if last is None or version is None:
        raise RuntimeError("map_many.cjs ended without its last line")
    return made, errors, version, last


def add_maps(repo, work=None, max_new=300, minutes=10.0, deadline=None, node=None, log=print):
    """Returns a dict report. Never raises for a failure of the map step (the report has "failed"); files untouched then."""
    rep = {"listed": 0, "missing": 0, "added": 0, "errors": 0, "left": 0, "failed": "", "bytes_before": 0, "bytes_after": 0,
           "gz_before": 0, "gz_after": 0, "w29": ""}
    repo = Path(repo).resolve()
    work = Path(work) if work else repo.parent / "singles-maps-work"
    node = node or os.environ.get("NODE") or "node"
    tmps = []
    try:
        lst = listed(repo)
        if lst is None:
            rep["failed"] = "views/map-lists.txt missing"
            return rep
        rep["listed"] = len(lst)
        if not ((repo / BUNDLE_GZ).exists() and (repo / BUNDLE_JSON).exists()):
            rep["failed"] = "bundle missing"
            return rep
        doc, gz_old, plain_old = read_bundle(repo)
        rep["bytes_before"], rep["gz_before"] = len(plain_old), len(gz_old)
        bits = dict(lst)
        missing = sorted(a for a in bits if a not in doc["s"])
        rep["missing"] = len(missing)
        if not missing:
            return rep
        stop = time.time() + minutes * 60
        if deadline:
            stop = min(stop, deadline)
        if stop <= time.time() + 5:
            rep["failed"] = "no time left"
            rep["left"] = len(missing)
            return rep
        tfile = work / "map-table.json"
        work.mkdir(parents=True, exist_ok=True)
        tfile.write_bytes(dumps({"t": doc["t"]}))
        made, errors, version, last = run_node(repo, work, missing, tfile, 2 * max_new + 20, stop, node)
        rep["w29"] = version
        rep["errors"] = len(errors)
        tlen, tver = len(doc["t"]["n"]), doc["t"].get("v")
        new = {}
        for a in missing:                                     # file order = address order: the same ones every run
            m = made.get(a)
            if m is None or not good_view(m["view"], a, tlen, tver):
                continue
            new[a] = m
            if len(new) >= max_new:
                break
        rep["left"] = len(missing) - len(new)
        if not new:
            return rep
        # ---- merged documents, in memory
        s = dict(doc["s"])
        k = dict(doc["k"])
        for a, m in new.items():
            s[a] = m["view"]
            k[a] = bits[a]
        out = dict(doc)                                       # key order v, t, s, k as the PC publish
        out["s"] = {a: s[a] for a in sorted(s)}
        out["k"] = {a: k[a] for a in sorted(k)}
        plain_new = dumps(out)
        gz_new = gzip.compress(plain_new, compresslevel=9, mtime=0)
        # ---- validate before anything is written
        chk = json.loads(plain_new.decode("utf-8"))
        if chk["t"] != doc["t"] or chk["v"] != doc["v"] or list(chk) != list(doc):
            raise ValueError("table / header changed")
        if any(chk["s"].get(a) != v for a, v in doc["s"].items()) or any(chk["k"].get(a) != v for a, v in doc["k"].items()):
            raise ValueError("an old entry changed")
        if len(chk["s"]) != len(doc["s"]) + len(new) or set(chk["s"]) - set(doc["s"]) != set(new):
            raise ValueError("entries added are not exactly the new ones")
        if gzip.decompress(gz_new) != plain_new:
            raise ValueError("gzip does not round trip")
        writes = [(BUNDLE_JSON, plain_new), (BUNDLE_GZ, gz_new)]
        # ---- loot side file: same rules, optional (a file that is missing / unreadable is left alone)
        lp = repo / LOOT
        if lp.exists():
            try:
                lraw = lp.read_bytes()
                ldoc = json.loads(lraw.decode("utf-8"))
                if isinstance(ldoc.get("views"), dict) and ldoc.get("format") == 1:
                    lv = dict(ldoc["views"])
                    added = 0
                    for a, m in new.items():
                        if a not in lv and m["loot"] is not None and good_loot(m["loot"], m["view"]):
                            lv[a] = m["loot"]
                            added += 1
                    if added:
                        lout = dict(ldoc)
                        lout["views"] = {a: lv[a] for a in sorted(lv)}
                        lnew = dumps(lout)
                        lchk = json.loads(lnew.decode("utf-8"))
                        if any(lchk["views"].get(a) != v for a, v in ldoc["views"].items()) or lchk["format"] != 1:
                            raise ValueError("an old loot entry changed")
                        writes.append((LOOT, lnew))
            except Exception as exc:                          # the loot file is a convenience: the maps still go
                log(f"maps: loot file not updated: {exc}")
        # ---- write through temp files, rename, restore on failure
        old = {}
        for rel, body in writes:
            p = repo / rel
            old[rel] = p.read_bytes() if p.exists() else None
            t = p.with_name(p.name + ".singles-maps.tmp")
            tmps.append(t)
            t.write_bytes(body)
        done = []
        try:
            for rel, _ in writes:
                os.replace(repo / (str(rel) + ".singles-maps.tmp"), repo / rel)
                done.append(rel)
        except Exception:
            for rel in done:
                if old[rel] is not None:
                    (repo / rel).write_bytes(old[rel])
            raise
        rep["added"] = len(new)
        rep["bytes_after"], rep["gz_after"] = len(plain_new), len(gz_new)
        rep["files"] = [str(r).replace("\\", "/") for r, _ in writes]
        return rep
    except Exception as exc:                                  # nothing was renamed (or it was undone): files as before
        rep["failed"] = f"{type(exc).__name__}: {str(exc)[:200]}"
        rep["added"] = 0
        return rep
    finally:
        for t in tmps:
            try:
                t.unlink()
            except OSError:
                pass


def main(argv=None):
    ap = argparse.ArgumentParser(prog="maps.py")
    ap.add_argument("--repo", default=".")
    ap.add_argument("--work")
    ap.add_argument("--max", type=int, default=int(os.environ.get("SINGLES_MAPS_MAX") or 300))
    ap.add_argument("--minutes", type=float, default=float(os.environ.get("SINGLES_MAPS_MINUTES") or 6))
    ap.add_argument("--deadline", type=float, help="epoch seconds: nothing is started after it")
    ap.add_argument("--message", help="append one line to this commit message file when maps were added")
    args = ap.parse_args(argv)
    t0 = time.time()
    rep = add_maps(args.repo, args.work, args.max, args.minutes, args.deadline)
    rep["seconds"] = round(time.time() - t0, 1)
    print("maps: " + json.dumps(rep, sort_keys=True))
    if rep["added"] and args.message:
        with open(args.message, "a", encoding="utf-8") as f:
            f.write(f"maps: +{rep['added']} map views (views/top100.json.gz, .json, top100-loot.json)\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
