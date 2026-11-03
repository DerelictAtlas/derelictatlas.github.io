"""Singles publisher: visitor-scanned single systems -> singles/ + index/singles.csv + views/singles-extras.csv
(+ singles/none.csv: recomputed no-derelict systems, singles/held.csv: while NONE_VERIFIED is off, systems whose
recompute gave scan status 4). Addresses of systems that do not exist in-game (index >= the region's W29d system count,
or the portal rule rejects them) are rejected as 'nonexistent' with the reason, never held (user 2026-11-01).

Runs in the GitHub Action .github/workflows/singles.yml (through tools/singles/action.sh) and locally for tests.
Python 3 standard library only; Node runs the site's own W29 WebAssembly scanner (tools/singles/scan_many.cjs).
Design: docs/SINGLES_FORMAT.md of the scanner (not in this repo); summary in tools/singles/README.md.

  python3 -I tools/singles/singles.py check-w29    [--repo .]
  python3 -I tools/singles/singles.py fetch-issues --out issues.json            (GitHub API, env GH_TOKEN + GITHUB_REPOSITORY)
  python3 -I tools/singles/singles.py process      --issues-file issues.json --summary summary.json [--repo .]
             [--cache scan-cache.jsonl] [--message msg.txt] [--run-id N] [--workers N (0 = all CPUs)] [--utc ISO]
             [--deadline EPOCH] [--split-bytes N] [--community-total N] [--atlas-cap N] [--none-verified]   (the last four: tests)
  python3 -I tools/singles/singles.py comment      --summary summary.json [--dry-run calls.jsonl]
  python3 -I tools/singles/singles.py pages-build                              (never fails)

Untrusted input: issue titles / bodies are only ever matched line by line against strict regular expressions
(ADDRESS16 = 16 hex digits; "none ADDRESS16" and "scanner <[0-9a-f+]{1,40}>" in relay batches v2; or
"<galaxy 0-255>:<12 glyph hex digits>"); nothing else of them is used, printed or echoed.
v3 batches (V3UP 2026-11-02, "single-scan batch v3"): the relay files the visitors' FINISHED scan results (index row +
extras line per system, or "none"); they are verified, not rescanned: format + ranges + consistency (atlas_rules
v3_check_row / v3_check_extras, the same rules as the relay), the W29d rule, the scanner tables fingerprint, and a
rescan of a 1 % sample (at least 1 per issue), of conflicting uploads and (after 1,000,000 systems) of top-list
entries; one rescan mismatch drops the whole batch. report-system issues (title = ADDRESS16) are rescanned and the
published row is verified / replaced / handed to the scanner agent (label report-pc). README "v3 results upload".
Exit codes: 0 ok, 1 error, 2 usage, 3 W29 integrity failure (scan/ files do not match scan/w29.json), 4 W29d region
count failure (tools/singles/w29d/ files do not match their pinned sha256, Node / the wasm does not start, the
self-test fails, or a count fails): the run stops, there is no fallback range.
"""
from __future__ import annotations
import argparse
import base64
import csv
import gzip
import hashlib
import io
import json
import math
import os
import queue
import random
import re
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import zlib
from pathlib import Path

sys.dont_write_bytecode = True                                 # no __pycache__ in the repo checkout
sys.path.insert(0, str(Path(__file__).resolve().parent))      # python -I does not add the script folder
import atlas_rules as R  # noqa: E402
import rerank as RK      # noqa: E402   RANK1: map-list re-rank (as the PC build), tools/singles/rerank.py

HERE = Path(__file__).resolve().parent
# ---- the site's scanner (SITE -09 owns scan/; path confirmed 2026-10-31) ----
SCAN_DIR = "scan"
WASM_FILE = "scan_w29.wasm"
JS_FILE = "w29_scan.js"
W29_JSON = "w29.json"
# Key names in scan/w29.json (ONE place). Also accepted: {"version": ..., "sha256": {"scan_w29.wasm": ..., "w29_scan.js": ...}}
W29_KEYS = {"version": "version", "wasm_sha256": "wasm_sha256", "js_sha256": "js_sha256", "nested": "sha256"}
NODE_HELPER = HERE / "scan_many.cjs"
# ---- the region system count: RE_FULL W29d (RE -fa, DONE 2026-11-01), a port of the game's count code: == the
#      Unicorn rc_worker on 6,116 random regions of 256 galaxies, == all 723 published '# region_systems', hotfix exe
#      100/100. tools/singles/w29d/ holds UNCHANGED copies of re-full/fast/w29d/bin/w29d_rc.wasm and node/w29d_rc.js,
#      pinned by sha256 (a mismatch stops the run, exit 4). region_count.cjs serves the counts (one Node process per run).
W29D_DIR = HERE / "w29d"
W29D_FILES = {"w29d_rc.wasm": "bf3930027ec503ffb6baa306bc6235ae0ebe5657ba94875e43f3103604a8299a",
              "w29d_rc.js": "fb03172e7fb1cf6d284114a4a85c8aea33b44d7f3f997270c98a540e0a925827"}
W29D_HELPER = HERE / "region_count.cjs"
# (galaxy, REGION8, count) checked at every start: a published region file, a core region (0), two of RE's Unicorn
# reference regions (galaxy FF; galaxy 0A at Y = -126, Z = -2048, X = +2047: count 519, but a bad coordinate for the
# portal rule)
W29D_SELFTEST = ((0x00, "02603CA6", 552), (0x00, "00000000", 0), (0xFF, "767A68DE", 541), (0x0A, "828007FF", 519))
# (galaxy, REGION8, index, w29d_valid_system code with purple unlocked) checked at every start (W29DW-2): purple window
# start / end valid, one past the window = 4 index_range, core = 2, bad coordinate = 1 (codes: RE W29d report)
W29D_PURPLE_SELFTEST = ((0x00, "02603CA6", 0x3E8, 0), (0x00, "02603CA6", 0x428, 0), (0x00, "02603CA6", 0x429, 4),
                        (0x00, "00000000", 0x3E8, 2), (0x0A, "828007FF", 0x3E8, 1))
W29D_TIMEOUT = 60               # seconds for one count (~21 ms each) or the start, before the run stops
# ---- inputs ----
LABEL = "single-scan"
MAX_PER_ISSUE = 3000            # addresses taken from one issue (= the relay's batch_max; the rest is reported)
MAX_PER_RUN = 20_000            # addresses to SCAN per run (issues that would pass it wait for the next run, untouched)
MAX_ISSUES = 200                # issues per run
MAX_TEXT = 100_000              # characters of title + body searched per issue (GitHub bodies are < 65,536)
# Relay batch issues (the Pi relay, 2026-10-31): title "single-scan batch YYYY-MM-DD HH:MMZ (<n>)", label single-scan.
#   v1 body: BATCH_V1 line, then one upper-case ADDRESS16 per line (unique), nothing else.
#   v2 body (CONTRIB 2026-10-31): BATCH_V2 line, then lines "ADDRESS16" (found in the browser), "none ADDRESS16"
#   (scanned in the browser, no derelict) or "scanner <token>" (informational, logged). Every address is recomputed.
BATCH_V1 = "single-scan batch v1"
BATCH_V2 = "single-scan batch v2"
V1_LINE = re.compile(r"[0-9A-F]{16}")
V2_NONE = re.compile(r"none ([0-9A-F]{16})")
V2_SCANNER = re.compile(r"scanner ([0-9a-f+]{1,40})")
MAX_SCANNERS = 10               # scanner tokens kept per issue (summary / log only)
#   v3 body (V3UP 2026-11-02): BATCH_V3 line, then ONE fenced block (``` lines) of base64(gzip(JSON lines)), one
#   record per system: {"address","fp","scanner","row","extras"} (the visitor's scan result: index row + extras line,
#   format = atlas_rules.V3_ROW_HEADER / V3_EXTRAS_HEADER) or {"address","fp","scanner","none":true}.
BATCH_V3 = "single-scan batch v3"
V3_MAX_RAW = 4_000_000          # bytes of one v3 payload after gunzip (a 2,000-system relay issue is < 2 MB)
V3_SAMPLE_PERCENT = 1           # rescanned share of a v3 batch's new rows (at least 1 per issue; seed = issue number)
V3_EXTRA_FPS = frozenset()      # tables fingerprints accepted besides the live scan/w29.json one (none: a new game
                                # table set makes every older upload invalid)
# report-system issues (V3UP): a visitor reports a wrong system; title = exactly one ADDRESS16 (also accepted WITHOUT
# the label: any open issue whose trimmed title is exactly 16 hex digits and that has no single-scan label, because
# GitHub drops ?labels= for visitors; SITE links .github/ISSUE_TEMPLATE/report-system.md, which sets the label)
REPORT_LABEL = "report-system"
REPORT_PC_LABEL = "report-pc"   # added when a PC atlas row differs from the rescan: left open for the scanner agent
REPORT_MAX = 50                 # report rescans per run (the rest wait, untouched)
REPORT_TITLE = re.compile(r"[ \t]*([0-9A-Fa-f]{16})[ \t]*")
REPORT_RESULTS = ("bad_title", "invalid", "nonexistent", "pending", "error", "no_derelict", "published", "verified",
                  "replaced", "differs")
# Any other single-scan issue (e.g. filed by hand): one address per line, "<ADDRESS16>" or "<galaxy>:<12 glyphs>"
LINE_RE = re.compile(r"(?:scan[ \t]+)?(?:([0-9]{1,3}):([0-9A-Fa-f]{12})|([0-9A-Fa-f]{16}))")
# ---- scanning ----
FRESH_EVERY = 100               # new wasm instance every N systems (~30 MB fresh, ~120 MB after ~1,000 systems)
CHUNK = 50                      # addresses per Node process
SYSTEM_TIMEOUT = 120            # seconds per address (no output from Node) before it counts as an error (worst known ~7 s)
SCAN_CHECK_BUILD = "7.05"       # the wasm's own check column uses the 7.05 fingerprint (RE_FULL W29b; W29e with
                                # checkFingerprint: null, which scan_many.cjs passes)
# Fingerprints a scan row's check may carry: 7.05 (W29b/c, W29e with checkFingerprint null) or the W29e default (the
# hotfix fingerprint, RE_FULL W29e step 4). The row is re-signed with SINGLES_BUILD either way.
# ---- outputs ----
# Stamp of the rows the Action signs (user decision 2026-10-31 via the scanner agent: the installed 7.10 hotfix; was
# "7.10 D1C71557"). Files and rows stamped 7.05 / 7.10 are still read (KNOWN_FPS) and re-signed with this stamp.
SINGLES_BUILD = "7.10-b26295378"
SINGLES_EXTRAS_MAX = 2          # views/singles-extras.csv never follows the atlas extras past format 2 (format 3 = + items_all)
SINGLES_FP = R.FINGERPRINTS[SINGLES_BUILD]
KNOWN_FPS = frozenset(R.FINGERPRINTS.values())
GAME_BUILD_TAG = f"{SINGLES_BUILD} {R.EXE_SHAS[SINGLES_BUILD][:8]}"
SINGLES_FORMAT = 1
SPLIT_BYTES = 1_000_000         # a bucket file over this splits one level down (galaxy -> layer YY -> group Z)
SINGLES = Path("singles")
MANIFEST = SINGLES / "manifest.json"
INDEX_SINGLES = Path("index") / "singles.csv"
EXTRAS_SINGLES = Path("views") / "singles-extras.csv"
NONE_FILE = SINGLES / "none.csv"            # recomputed no-derelict systems (scan status 4)
HELD_FILE = SINGLES / "held.csv"            # held addresses + reason (HELD_STATUS4), retried every run
HELD_MAX = 50_000                           # held.csv size cap (oldest first_seen dropped)
# Scan status 4 ("no abandoned freighter") of the browser engine is UNVERIFIED (RE job W31 checks it against the game;
# the PC publishes rows for some of these systems). While False, a status-4 recompute is neither written to none.csv
# nor rejected: the address is held with reason "status4" and retried once this is True. True = none.csv as designed.
NONE_VERIFIED = False
HELD_RANGE = "range"                        # OLD held reason (until W29DW-3, 2026-11-01): outside every known range.
                                            # Such rows are still read, re-checked every run and dropped when the
                                            # system does not exist in-game (it never will: the W29d count is exact)
HELD_STATUS4 = "status4"                    # held reason: recompute gave status 4 while NONE_VERIFIED is False
HELD_REASONS = (HELD_RANGE, HELD_STATUS4)   # reasons a held.csv row may have when read (new rows: only status4)
HELD_DETAIL = {HELD_STATUS4: "scan status 4 (no derelict) is not verified yet (kept in singles/held.csv, retried once "
                             "verified)"}
NONEXISTENT = "does not exist in-game"     # outcome 'nonexistent': detail = f"{NONEXISTENT} ({why})"
WORK_FILE = Path("stats") / "work.txt"      # region + system index work list (written by the PC; SITE format)
NONE_FORMAT = 1
HELD_FORMAT = 2                             # 2: + reason column (format 1 rows = reason range are still read)
FINDERS_FILE = Path("views") / "finders.csv"   # FINDER1: the first finder name per published single (public)
FINDERS_HEADER = "address,finder,found_utc"
FINDERS_FORMAT = 1
FINDER_BLOCK = Path("tools") / "singles" / "finder_block.txt"   # hand-edited: ADDRESS16 or name:<finder> per line
SPEED_FILE = Path("stats") / "speed.json"       # FINDER1: cumulative scan speed of accepted v3 uploads (public)
SPEED_FORMAT = 1
SPEED_BINS = 64                                 # log-spaced histogram bins from SPEED_LO to SPEED_HI ms (~14 % wide)
SPEED_LO, SPEED_HI = 20, 120000                 # ms; perf values outside are dropped
REPORT_REASONS_LINE = re.compile(r"Reasons: ([a-z]+(?:, [a-z]+)*)")   # line 1 of a relay report issue (relay 1.3)
OUTPUTS = (SINGLES.as_posix() + "/", INDEX_SINGLES.as_posix(), EXTRAS_SINGLES.as_posix(), FINDERS_FILE.as_posix(),
           SPEED_FILE.as_posix())
NO_TIME = "1970-01-01T00:00:00Z"
API = "https://api.github.com"


class W29Error(RuntimeError):
    pass


class W29dError(RuntimeError):
    pass


def sha256_file(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def write_if_changed(path: Path, text: str, changed: list, rel: str):
    data = text.encode("utf-8")
    if path.exists() and path.read_bytes() == data:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    changed.append(rel)


def remove(path: Path, changed: list, rel: str):
    if path.exists():
        path.unlink()
        changed.append(rel)


# ======================================================================= W29 integrity
def node_cmd():
    return os.environ.get("NODE") or "node"


def check_w29(repo: Path):
    """The scan/ files must match scan/w29.json (sha256 of both + the w29_version() string). Returns the version."""
    d = repo / SCAN_DIR
    try:
        meta = json.loads((d / W29_JSON).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise W29Error(f"{SCAN_DIR}/{W29_JSON} missing or unreadable: {exc}") from None
    nested = meta.get(W29_KEYS["nested"]) if isinstance(meta.get(W29_KEYS["nested"]), dict) else {}
    want = {WASM_FILE: meta.get(W29_KEYS["wasm_sha256"]) or nested.get(WASM_FILE),
            JS_FILE: meta.get(W29_KEYS["js_sha256"]) or nested.get(JS_FILE)}
    version = meta.get(W29_KEYS["version"])
    if not isinstance(version, str) or not version:
        raise W29Error(f"{SCAN_DIR}/{W29_JSON} has no '{W29_KEYS['version']}' string")
    for name, h in want.items():
        if not isinstance(h, str) or not re.fullmatch(r"[0-9a-fA-F]{64}", h):
            raise W29Error(f"{SCAN_DIR}/{W29_JSON} has no sha256 for {name}")
        if not (d / name).exists():
            raise W29Error(f"{SCAN_DIR}/{name} is missing")
        got = sha256_file(d / name)
        if got != h.lower():
            raise W29Error(f"{SCAN_DIR}/{name} sha256 {got} does not match {W29_JSON} ({h.lower()})")
    with tempfile.TemporaryDirectory() as t:
        empty = Path(t) / "none.txt"
        empty.write_text("", encoding="utf-8")
        p = subprocess.run([node_cmd(), str(NODE_HELPER), str(d), str(empty)], capture_output=True, text=True,
                           encoding="utf-8", timeout=120)
    try:
        got = json.loads(p.stdout.splitlines()[0])["w29_version"]
    except (IndexError, ValueError, KeyError):
        raise W29Error(f"the wasm did not start: {p.stderr.strip()[-300:]}") from None
    if version_key(got) != version_key(version):
        raise W29Error(f"w29_version() is {got!r}, {W29_JSON} says {version!r}")
    return got          # as the wasm reports it right after create (deterministic; scan_many.cjs prints the same)


def version_key(v):
    """w29_version() without W29e's trailing '; check fingerprint <16 hex>': that part is the CURRENT check
    fingerprint (runtime state: b93f4648... right after create and with checkFingerprint null, c00eb4b1... after a
    scan with W29e's defaults), so a w29.json written either way matches. The sha256 checks pin the files."""
    return re.sub(r"; check fingerprint [0-9a-f]{16}$", "", v)


# ======================================================================= W29d region system count
class RegionCounts:
    """The game's system count of a region (R.system_known rule (c)): RE's W29d wasm in ONE Node process per run
    (region_count.cjs), each (galaxy, REGION8) counted once per run (self.cache). The query is the address as it is:
    galaxy = ADDRESS16[6:8], REGION8 = ADDRESS16[8:] = Y<<24 | Z<<12 | X (12 / 8-bit two's complement) = w29d's
    ua_lo, the same input as the PC's rc_worker.py (region_count_705.region_ua). Every failure raises W29dError; there
    is no fallback rule."""

    def __init__(self, w29d_dir=None):
        self.dir = Path(w29d_dir) if w29d_dir else W29D_DIR
        self.p = self.q = self.err = None
        self.cache = {}
        self.purple_cache = {}          # (galaxy, REGION8, index) -> w29d_valid_system code (purple unlocked)
        self.computed = 0               # counts computed after the self-test (summary 'region_counts')
        self.purple_computed = 0        # portal checks after the self-test (summary 'portal_checks')

    def check_files(self):
        for name, want in W29D_FILES.items():
            p = self.dir / name
            if not p.is_file():
                raise W29dError(f"{p} is missing")
            got = sha256_file(p)
            if got != want:
                raise W29dError(f"{name} sha256 {got} is not the pinned W29d file ({want})")

    def start(self):
        """Check the pinned files, start Node, run the self-test. Returns the number of self-test cases."""
        if self.p is not None:
            return len(W29D_SELFTEST) + len(W29D_PURPLE_SELFTEST)
        self.check_files()
        self.err = tempfile.TemporaryFile()
        try:
            self.p = subprocess.Popen([node_cmd(), str(W29D_HELPER), str(self.dir)], stdin=subprocess.PIPE,
                                      stdout=subprocess.PIPE, stderr=self.err, text=True, encoding="utf-8", bufsize=1)
        except OSError as exc:
            raise W29dError(f"Node did not start: {exc}") from None
        self.q = queue.Queue()
        threading.Thread(target=lambda out, q: ([q.put(l) for l in out], q.put(None)), args=(self.p.stdout, self.q),
                         daemon=True).start()
        first = self._line("start")
        if first != {"w29d": "ready"}:
            raise W29dError(f"region_count.cjs did not start: {first!r} {self._stderr()}")
        for gal, region, want in W29D_SELFTEST:
            got = self.count(gal, region)
            if got != want:
                raise W29dError(f"self-test: galaxy {gal:02X} region {region} counted {got}, want {want}")
        for gal, region, idx, want in W29D_PURPLE_SELFTEST:
            got = self.valid_code(gal, region, idx)
            if got != want:
                raise W29dError(f"self-test: galaxy {gal:02X} region {region} index {idx:03X} portal code {got}, "
                                f"want {want}")
        self.computed = self.purple_computed = 0
        return len(W29D_SELFTEST) + len(W29D_PURPLE_SELFTEST)

    def _stderr(self):
        try:
            self.err.seek(0)
            return self.err.read().decode("utf-8", "replace").strip()[-300:]
        except (OSError, ValueError, AttributeError):
            return ""

    def _line(self, what):
        try:
            line = self.q.get(timeout=W29D_TIMEOUT)
        except queue.Empty:
            raise W29dError(f"no answer from region_count.cjs within {W29D_TIMEOUT} s ({what})") from None
        if line is None:
            raise W29dError(f"region_count.cjs ended ({what}): {self._stderr()}")
        try:
            return json.loads(line)
        except ValueError:
            raise W29dError(f"region_count.cjs wrote {line[:80]!r} ({what})") from None

    def count(self, galaxy, region):
        """System count 0..4095 of (galaxy 0..255, REGION8)."""
        key = (int(galaxy), str(region).upper())
        if key in self.cache:
            return self.cache[key]
        if self.p is None:
            self.start()
        q = f"{key[0]:02X} {key[1]}"
        if not re.fullmatch(r"[0-9A-F]{2} [0-9A-F]{8}", q):
            raise W29dError(f"not a region: galaxy {galaxy!r} region {region!r}")
        try:
            self.p.stdin.write(q + "\n")
            self.p.stdin.flush()
        except (OSError, ValueError) as exc:
            raise W29dError(f"region_count.cjs is gone: {exc} {self._stderr()}") from None
        r = self._line(q)
        n = r.get("count") if isinstance(r, dict) and r.get("q") == q else None
        if not isinstance(n, int) or isinstance(n, bool) or not 0 <= n <= 0xFFF:
            raise W29dError(f"region count of {q} failed: {r!r}")
        self.cache[key] = n
        self.computed += 1
        return n

    def valid_code(self, galaxy, region, idx):
        """w29d_valid_system code (0 valid, 1 bad_coord, 2 core, 3 index_zero, 4 index_range, 5 fault) of system idx
        of (galaxy, REGION8) with purple unlocked; cached per (galaxy, region, index)."""
        key = (int(galaxy), str(region).upper(), int(idx))
        if key in self.purple_cache:
            return self.purple_cache[key]
        if self.p is None:
            self.start()
        q = f"V {key[0]:02X} {key[1]} {key[2]:03X}"
        if not re.fullmatch(r"V [0-9A-F]{2} [0-9A-F]{8} [0-9A-F]{3}", q):
            raise W29dError(f"not a system: galaxy {galaxy!r} region {region!r} index {idx!r}")
        try:
            self.p.stdin.write(q + "\n")
            self.p.stdin.flush()
        except (OSError, ValueError) as exc:
            raise W29dError(f"region_count.cjs is gone: {exc} {self._stderr()}") from None
        r = self._line(q)
        c = r.get("valid") if isinstance(r, dict) and r.get("q") == q else None
        if not isinstance(c, int) or isinstance(c, bool) or not 0 <= c <= 4:
            raise W29dError(f"portal check of {q} failed: {r!r}")
        self.purple_cache[key] = c
        self.purple_computed += 1
        return c

    def nonexistent_reason(self, galaxy, region, idx):
        """Why system idx of (galaxy, REGION8) does not exist in-game (R.system_known said no): the portal rule's
        reason in the purple window and for an empty region (core / bad coordinate), else the region's count."""
        n = self.count(galaxy, region)
        code = self.valid_code(galaxy, region, idx) if R.PURPLE[0] <= idx <= R.PURPLE[1] or n == 0 else None
        if code == 2:
            return f"system index {idx:03X}, galactic core region (no systems)"
        if code == 1:
            return f"system index {idx:03X}, region coordinates outside the galaxy"
        return f"system index {idx:03X}, region has {n} systems"

    def purple_valid(self, galaxy, region, idx):
        """True when the game's portal rule accepts system idx (purple window) with purple unlocked."""
        return self.valid_code(galaxy, region, idx) == 0

    def close(self):
        if self.p is not None:
            try:
                self.p.stdin.close()
                self.p.wait(timeout=10)
            except (OSError, ValueError, subprocess.TimeoutExpired):
                self.p.kill()
                self.p.wait()
            self.p = None
        if self.err is not None:
            self.err.close()
            self.err = None


# ======================================================================= issues + addresses
def _canonical(m):
    """ADDRESS16 (upper, 000SSSGGYYZZZXXX) of a LINE_RE match, or None (galaxy > 255, not a 000... address)."""
    if m.group(3):
        a = m.group(3).upper()
        return a if a[:3] == "000" else None
    gal, g = int(m.group(1)), m.group(2).upper()
    return f"000{g[1:4]}{gal:02X}{g[4:]}" if gal <= 255 else None


def parse_issue(title, body):
    """{"addrs": [ADDRESS16 in order of appearance, unique], "none": {addresses only claimed as 'none'}, "bad": number
    of ignored non-empty lines, "scanners": [scanner tokens], "format": "v1" | "v2" | "other"}.
    Relay batch (body line 1 exactly BATCH_V1 / BATCH_V2): every further line must be exactly one upper-case ADDRESS16
    (V1_LINE), or in v2 also "none ADDRESS16" / "scanner <token>"; the title is not read. Any other issue: every line
    of title + body must be exactly one address in either form (LINE_RE, optionally after 'scan '). '\\r' and empty
    lines are ignored; nothing else is used. An address reported both as found and as none counts as found."""
    title = title if isinstance(title, str) else ""
    body = body if isinstance(body, str) else ""
    lines = body[:MAX_TEXT].replace("\r", "").split("\n")
    fmt = {BATCH_V1: "v1", BATCH_V2: "v2", BATCH_V3: "v3"}.get(lines[0] if lines else None, "other")
    if fmt == "v3":
        recs, err = parse_v3_body(lines[1:])
        scanners = list(dict.fromkeys(r["scanner"] for r in recs.values()))[:MAX_SCANNERS]
        return {"addrs": list(recs), "none": {a for a, r in recs.items() if r.get("none")}, "bad": 0,
                "scanners": scanners, "format": "v3", "records": recs, "error": err}
    if fmt != "other":
        lines = lines[1:]
    else:
        lines = title[:1000].replace("\r", "").split("\n") + lines
    out, bad, seen, none, scanners = [], 0, set(), set(), []
    for line in lines:
        if not line.strip():
            continue
        claim = "found"
        if fmt != "other":
            a = line if V1_LINE.fullmatch(line) and line[:3] == "000" else None
            if a is None and fmt == "v2":
                m = V2_NONE.fullmatch(line)
                if m and m.group(1)[:3] == "000":
                    a, claim = m.group(1), "none"
                else:
                    m = V2_SCANNER.fullmatch(line)
                    if m:
                        if m.group(1) not in scanners and len(scanners) < MAX_SCANNERS:
                            scanners.append(m.group(1))
                        continue
        else:
            m = LINE_RE.fullmatch(line.strip())
            a = _canonical(m) if m else None
        if a is None:
            bad += 1
            continue
        if claim == "found":
            none.discard(a)
        elif a not in seen:
            none.add(a)
        if a not in seen:
            seen.add(a)
            out.append(a)
    return {"addrs": out, "none": none, "bad": bad, "scanners": scanners, "format": fmt}


def _no_dup(pairs):
    out = {}
    for k, v in pairs:
        if k in out:
            raise ValueError("a record has a key twice")
        out[k] = v
    return out


def _no_const(_name):
    raise ValueError("a record has NaN / Infinity")


def v3_record(rec):
    """rec if it is a valid v3 record (the relay's queue3.jsonl / issue line), else ValueError(reason). Checks (a)
    and (d) of the README: shape, address, fp / scanner form, the row and extras line rules (atlas_rules.v3_check_row
    / v3_check_extras), and that the row's glyphs + galaxy and the extras address are the record's address."""
    if not isinstance(rec, dict):
        raise ValueError("a record is not an object")
    if set(rec) - {"finder", "perf"} not in ({"address", "fp", "scanner", "none"},
                                             {"address", "fp", "scanner", "row", "extras"}):
        raise ValueError("a record has the wrong keys")
    a = rec["address"]
    if not isinstance(a, str) or not R.V3_ADDRESS.fullmatch(a) or a[3:6] == "000":
        raise ValueError("a record address is not an ADDRESS16")
    if not isinstance(rec["fp"], str) or not R.V3_FP.fullmatch(rec["fp"]):
        raise ValueError("a record fp is not 16 hex digits")
    if not isinstance(rec["scanner"], str) or not R.V3_SCANNER.fullmatch(rec["scanner"]):
        raise ValueError("a record scanner has the wrong form")
    if "none" in rec:
        if rec["none"] is not True:
            raise ValueError("a record none is not true")
        return v3_optional(rec)
    ra, _ = R.v3_check_row(rec["row"])
    ea, _ = R.v3_check_extras(rec["extras"])
    if ra != a or ea != a:
        raise ValueError("the row glyphs / galaxy or the extras address is not the record address")
    return v3_optional(rec)


def v3_optional(rec):
    """FINDER1: the record without an invalid "finder" (atlas_rules.v3_finder; only on rows) or "perf"
    (atlas_rules.v3_perf). An invalid one is dropped here, the batch is never rejected for it."""
    if "finder" not in rec and "perf" not in rec:
        return rec
    out = dict(rec)
    if "finder" in out:
        try:
            name = R.v3_finder(out["finder"]) if "none" not in out else ""
        except ValueError:
            name = ""
        if name:
            out["finder"] = name
        else:
            del out["finder"]
    if "perf" in out:
        try:
            ok = R.v3_perf(out["perf"]) is not None
        except (ValueError, TypeError):
            ok = False
        if not ok:
            del out["perf"]
    return out


# ======================================================================= FINDER1: finders.csv, finder_block, speed
def read_finder_block(repo):
    """tools/singles/finder_block.txt -> ({ADDRESS16}, {casefolded names}). One entry per line: an ADDRESS16 or
    name:<finder> (any case); empty lines and lines starting with # are ignored, so is anything else."""
    p = repo / FINDER_BLOCK
    addrs, names = set(), set()
    if p.exists():
        for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
            s = line.strip()
            if not s or s.startswith("#"):
                continue
            if s[:5].lower() == "name:":
                if s[5:].strip():
                    names.add(s[5:].strip().casefold())
            elif re.fullmatch(r"[0-9A-Fa-f]{16}", s):
                addrs.add(s.upper())
    return addrs, names


def read_finders(repo):
    """views/finders.csv -> {ADDRESS16: (finder, found_utc)}; invalid rows are dropped."""
    p, out = repo / FINDERS_FILE, {}
    if not p.exists():
        return out
    for line in p.read_text(encoding="utf-8").split("\n"):
        if not line or line.startswith("#") or line == FINDERS_HEADER:
            continue
        c = line.split(",")
        if len(c) != 3 or c[0] in out or not R.V3_ADDRESS.fullmatch(c[0]) or iso(c[2]) != c[2]:
            continue
        try:
            if R.v3_finder(c[1]) != c[1] or not c[1]:
                continue
        except ValueError:
            continue
        out[c[0]] = (c[1], c[2])
    return out


def finders_text(finders):
    return (FINDERS_HEADER + "\n" +
            f"# nms-derelict-atlas finders format {FINDERS_FORMAT}: the name (\"Atlas scout\") a visitor sent with the v3 "
            "upload that first published the system as a single; the first one wins and is never overwritten; never "
            "for a system of the PC atlas; found_utc = the time of that upload's issue (UTC); entries blocked in "
            "tools/singles/finder_block.txt are removed every run; rows sorted by address\n" +
            "".join(f"{a},{n},{t}\n" for a, (n, t) in sorted(finders.items())))


def _speed_bin(ms):
    return min(SPEED_BINS - 1, int(math.log(ms / SPEED_LO) / math.log(SPEED_HI / SPEED_LO) * SPEED_BINS))


def _speed_mid(i):
    return round(SPEED_LO * (SPEED_HI / SPEED_LO) ** ((i + 0.5) / SPEED_BINS))


def speed_group(old=None):
    """A running group {n, sum, min, max, hist} (n / sum weighted, hist = SPEED_BINS counts), from a stored one or new."""
    g = {"n": 0, "sum": 0, "min": None, "max": None, "hist": [0] * SPEED_BINS}
    if isinstance(old, dict):
        h = old.get("hist")
        if (isinstance(old.get("n"), int) and isinstance(old.get("sum"), int) and isinstance(h, list)
                and len(h) == SPEED_BINS and all(isinstance(x, int) and x >= 0 for x in h) and sum(h) == old["n"]
                and (old["n"] == 0 or (isinstance(old.get("min"), int) and isinstance(old.get("max"), int)))):
            g.update(n=old["n"], sum=old["sum"], min=old.get("min"), max=old.get("max"), hist=list(h))
    return g


def speed_add(g, ms, w=1):
    if not isinstance(ms, int) or isinstance(ms, bool) or not SPEED_LO <= ms <= SPEED_HI or w < 1:
        return
    g["n"] += w
    g["sum"] += ms * w
    g["min"] = ms if g["min"] is None else min(g["min"], ms)
    g["max"] = ms if g["max"] is None else max(g["max"], ms)
    g["hist"][_speed_bin(ms)] += w


def speed_out(g):
    """The public group: avg (exact, weighted), min / max (exact), p10 / p50 / p90 (from the histogram: the middle of
    the bin, clamped to min..max, so about +-7 %), plus the running state n / sum / hist."""
    out = {"n": g["n"], "sum": g["sum"], "min": g["min"], "max": g["max"], "hist": g["hist"],
           "avg": round(g["sum"] / g["n"]) if g["n"] else None}
    for name, q in (("p10", 0.1), ("p50", 0.5), ("p90", 0.9)):
        v, acc = None, 0
        for i, c in enumerate(g["hist"]):
            acc += c
            if g["n"] and acc >= q * g["n"]:
                v = min(g["max"], max(g["min"], _speed_mid(i)))
                break
        out[name] = v
    return out


def update_speed(repo, perfs, run_utc, changed):
    """stats/speed.json: add the perf objects of this run's accepted v3 issues to the running totals."""
    if not perfs:
        return 0
    p = repo / SPEED_FILE
    try:
        old = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
    except (ValueError, OSError):
        old = {}
    old = old if isinstance(old, dict) and old.get("format") == SPEED_FORMAT else {}
    groups = {"overall": speed_group(old.get("overall"))}
    for k in ("by_dev", "by_speed", "by_preset"):
        groups[k] = {n: speed_group(v) for n, v in (old.get(k) or {}).items()
                     if isinstance(v, dict) and n in (R.PERF_ENUMS["dev"] if k == "by_dev" else R.PERF_ENUMS["speed"]
                                                      if k == "by_speed" else R.PERF_PRESETS)}
    batches = old.get("batches") if isinstance(old.get("batches"), int) else 0
    systems = old.get("systems") if isinstance(old.get("systems"), int) else 0
    for pf in perfs:
        w = pf.get("n", 1)
        batches += 1
        systems += w
        speed_add(groups["overall"], pf["ms"], w)
        for k, f in (("by_dev", "dev"), ("by_speed", "speed")):
            if f in pf:
                speed_add(groups[k].setdefault(pf[f], speed_group()), pf["ms"], w)
        for preset, ms in (pf.get("by_preset") or {}).items():
            speed_add(groups["by_preset"].setdefault(preset, speed_group()), ms, 1)
    doc = {"format": SPEED_FORMAT, "updated": run_utc, "batches": batches, "systems": systems,
           "note": "scan speed reported by the site's scanner with accepted v3 uploads (ms per system; anonymous: "
                   "no address, no name, no time per upload). Cumulative: running weighted count n / sum / min / "
                   "max plus a %d-bin log histogram %d-%d ms per group (no samples are kept); overall, by_dev and "
                   "by_speed weight each upload's median by its system count n, by_preset counts each upload once; "
                   "p10 / p50 / p90 come from the histogram (about +-7 %%); values outside %d-%d ms are dropped"
                   % (SPEED_BINS, SPEED_LO, SPEED_HI, SPEED_LO, SPEED_HI),
           "overall": speed_out(groups["overall"])}
    for k in ("by_dev", "by_speed", "by_preset"):
        doc[k] = {n: speed_out(g) for n, g in sorted(groups[k].items()) if g["n"]}
    write_if_changed(p, json.dumps(doc, sort_keys=True, separators=(",", ":")) + "\n", changed, SPEED_FILE.as_posix())
    return len(perfs)


def report_names_finder(body):
    """True when line 1 of a report body is the relay's "Reasons: ..." line and lists "name" (FINDER1)."""
    first = (body if isinstance(body, str) else "")[:300].replace("\r", "").split("\n", 1)[0]
    m = REPORT_REASONS_LINE.fullmatch(first)
    return bool(m) and "name" in m.group(1).split(", ")


def parse_v3_body(lines):
    """Lines after BATCH_V3 -> ({ADDRESS16: record} in order, error or None). The body must be exactly one fenced
    block of base64 (gzip of JSON lines, one record per line; at most V3_MAX_RAW bytes unpacked); any other line, a
    bad record or an address twice rejects the whole issue (error = the reason; column names only, no issue text)."""
    rest = [l for l in lines if l.strip()]
    if len(rest) < 3 or rest[0] != "```" or rest[-1] != "```":
        return {}, "the body is not one fenced block"
    b64 = "".join(rest[1:-1])
    if not re.fullmatch(r"[A-Za-z0-9+/]+={0,2}", b64):
        return {}, "the fenced block is not base64"
    try:
        data = base64.b64decode(b64, validate=True)
        d = zlib.decompressobj(wbits=31)
        raw = d.decompress(data, V3_MAX_RAW)
        if d.unconsumed_tail or not d.eof or d.unused_data:
            return {}, f"the payload is not one gzip stream of at most {V3_MAX_RAW} bytes"
        text = raw.decode("ascii")
    except (ValueError, zlib.error, UnicodeDecodeError):
        return {}, "the payload is not base64(gzip(ASCII JSON lines))"
    if not text.endswith("\n"):
        return {}, "the payload does not end with a line end"
    recs = {}
    for n, line in enumerate(text[:-1].split("\n"), 1):
        try:
            rec = v3_record(json.loads(line, object_pairs_hook=_no_dup, parse_constant=_no_const))
        except json.JSONDecodeError:
            return {}, f"record {n}: not JSON"
        except RecursionError:
            return {}, f"record {n}: nested too deeply"
        except ValueError as exc:                       # our own reasons: column names only
            return {}, f"record {n}: {exc}"
        if rec["address"] in recs:
            return {}, f"record {n}: the same system twice"
        recs[rec["address"]] = rec
    if not recs:
        return {}, "the payload has no records"
    return recs, None


def parse_addresses(title, body):
    """(addresses in order of appearance, unique; number of ignored non-empty lines): parse_issue without the rest."""
    r = parse_issue(title, body)
    return r["addrs"], r["bad"]


def label_names(issue):
    out = set()
    for lab in issue.get("labels") or []:
        n = lab.get("name") if isinstance(lab, dict) else lab
        if isinstance(n, str):
            out.add(n)
    return out


def is_report(it):
    """A report-system issue: the label, or (fallback, no single-scan label) a title of exactly one ADDRESS16."""
    names = label_names(it)
    if REPORT_LABEL in names:
        return True
    title = it.get("title") if isinstance(it.get("title"), str) else ""
    return LABEL not in names and bool(REPORT_TITLE.fullmatch(title[:100]))


def usable_issues(issues):
    """Open single-scan issues and report issues (no pull requests), oldest first; at most MAX_ISSUES single-scan
    issues + all reports (report rescans are capped separately, REPORT_MAX). A report gets the label REPORT_LABEL in
    the returned copy when it was found by its title only."""
    ok = []
    for it in issues if isinstance(issues, list) else []:
        if not isinstance(it, dict) or not isinstance(it.get("number"), int) or it.get("pull_request"):
            continue
        if it.get("state") != "open":
            continue
        if is_report(it):
            if REPORT_LABEL not in label_names(it):
                it = dict(it, labels=list(it.get("labels") or []) + [{"name": REPORT_LABEL}])
            ok.append(it)
            continue
        if LABEL not in label_names(it):
            continue
        ok.append(it)
    ok.sort(key=lambda i: (str(i.get("created_at") or ""), i["number"]))
    batches = [i for i in ok if REPORT_LABEL not in label_names(i)][:MAX_ISSUES]
    return sorted(batches + [i for i in ok if REPORT_LABEL in label_names(i)],
                  key=lambda i: (str(i.get("created_at") or ""), i["number"]))


def gh_request(method, path, body=None):
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if not token:
        raise RuntimeError("GH_TOKEN is not set")
    req = urllib.request.Request(API + path, method=method,
                                 data=None if body is None else json.dumps(body).encode("utf-8"),
                                 headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                                          "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "atlas-singles-bot"})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    return json.loads(data) if data else None


def repo_name():
    r = os.environ.get("GITHUB_REPOSITORY", "")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", r):
        raise RuntimeError("GITHUB_REPOSITORY is not set")
    return r


def fetch_issues(out_path):
    """Open issues labelled single-scan (<= MAX_ISSUES), labelled report-system, and (report fallback) every open issue
    whose title is exactly one ADDRESS16 (<= 2 x MAX_ISSUES looked at); one list, each issue once."""
    rn, got, seen = repo_name(), [], set()
    for label, cap, keep in ((LABEL, MAX_ISSUES, None), (REPORT_LABEL, MAX_ISSUES, None),
                             (None, 2 * MAX_ISSUES, lambda it: is_report(it))):
        n = 0
        for page in range(1, cap // 100 + 2):
            q = f"&labels={label}" if label else ""
            batch = gh_request("GET", f"/repos/{rn}/issues?state=open{q}&sort=created&direction=asc"
                                      f"&per_page=100&page={page}")
            if not isinstance(batch, list):
                break
            for it in batch:
                n += 1
                if it.get("number") in seen or (keep and not keep(it)):
                    continue
                seen.add(it.get("number"))
                got.append({"number": it.get("number"), "state": it.get("state"),
                            "labels": sorted(n for n in label_names(it) if isinstance(n, str)),
                            "created_at": it.get("created_at"), "pull_request": bool(it.get("pull_request")),
                            "title": (it.get("title") or "")[:MAX_TEXT], "body": (it.get("body") or "")[:MAX_TEXT]})
            if len(batch) < 100 or n >= cap:
                break
    Path(out_path).write_text(json.dumps(got, ensure_ascii=True) + "\n", encoding="utf-8")
    print(f"{len(got)} open {LABEL} / {REPORT_LABEL} issues")


# ======================================================================= published atlas (read only)
class Atlas:
    def __init__(self, repo: Path, counts=None):
        self.repo = repo
        self.counts = counts            # RegionCounts (rule (c) of R.system_known); None = no count (tests only)
        self._regions = {}
        self._index = None
        self._index_head = None
        self._work = None

    def region(self, galaxy, region):
        """None or {rows: {glyphs: line}, slim: {index: char}, range: R.region_range(), deferred, fp} of a region file."""
        key = (galaxy, region)
        if key not in self._regions:
            p = self.repo / R.region_path(galaxy, region)
            info = None
            if p.exists():
                lines = p.read_text(encoding="utf-8").splitlines()
                fp = R.file_fingerprint(lines)
                rng = R.region_range(lines)
                info = {"rows": {}, "slim": R.parse_slim(lines, fp), "range": rng, "deferred": rng[3], "fp": fp}
                for line in lines:
                    if R.is_row(line):
                        info["rows"][line.split(",", 1)[0].upper()] = line
            self._regions[key] = info
        return self._regions[key]

    def work(self):
        """({(galaxy, REGION8): set(system index)}, ignored lines) of stats/work.txt; ({}, 0) when there is none."""
        if self._work is None:
            p = self.repo / WORK_FILE
            self._work = R.parse_work(p.read_text(encoding="utf-8", errors="replace")) if p.exists() else ({}, 0)
        return self._work

    def known(self, address):
        """R.system_known for an ADDRESS16 (region file range / deferred list / stats/work.txt / region count / the
        portal rule for the purple window; the count and the portal rule are asked only when needed)."""
        gal, region, idx = int(address[6:8], 16), address[8:], int(address[3:6], 16)
        info = self.region(gal, region)
        count = (lambda: self.counts.count(gal, region)) if self.counts is not None else None
        purple = (lambda: self.counts.purple_valid(gal, region, idx)) if self.counts is not None else None
        return R.system_known(idx, info["range"] if info else None, self.work()[0].get((gal, region), set()), count,
                              purple)

    def _index_texts(self):
        """Yield the text of every main index file: format 7 shards (index/manifest.json), else index/systems.csv.gz."""
        man = self.repo / "index" / "manifest.json"
        if man.exists():
            try:
                doc = json.loads(man.read_text(encoding="utf-8"))
                paths = [s["path"] for s in doc.get("shards") or []] if doc.get("format") == 7 else []
            except (ValueError, KeyError, TypeError):
                paths = []
            if paths and all((self.repo / p).exists() for p in paths):
                for p in paths:
                    yield (self.repo / p).read_text(encoding="utf-8")
                return
        gz = self.repo / "index" / "systems.csv.gz"
        if gz.exists():
            yield gzip.decompress(gz.read_bytes()).decode("utf-8")

    def index(self):
        """{(galaxy, glyphs)} of the main index rows, and its first two lines (the '#' line + column header)."""
        if self._index is None:
            keys, head = set(), None
            for text in self._index_texts():
                lines = text.split("\n")
                if head is None and len(lines) >= 2:
                    head = lines[:2]
                for line in lines:
                    if line and not line.startswith("#") and not line.startswith("glyphs,"):
                        g, gal, _ = line.split(",", 2)
                        keys.add((int(gal), g.upper()))
            self._index, self._index_head = keys, head
        return self._index

    def index_head(self):
        self.index()
        return self._index_head

    def stats(self):
        try:
            return json.loads((self.repo / "stats" / "systems.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def total(self):
        """Community atlas total as the scanner reads it (atlas.Atlas.atlas_total): stats total_systems, else the
        index line 1 count."""
        s = self.stats()
        if s and isinstance(s.get("total_systems"), int):
            return s["total_systems"]
        head = self.index_head()
        m = re.search(r"format \d+: (\d+) systems", head[0]) if head else None
        return int(m.group(1)) if m else None

    def index_records(self):
        """Every main index row as a dict (index columns, strings), for the post-cap map list ranking."""
        for text in self._index_texts():
            lines = [l for l in text.split("\n") if l and not l.startswith("#")]
            yield from csv.DictReader(lines)

    def item_values(self):
        """{ADDRESS16: {items_value, items_nanites}} of views/extras.csv.gz (build_atlas_index.item_values_of)."""
        p = self.repo / "views" / "extras.csv.gz"
        if not p.exists():
            return {}
        lines = [l for l in gzip.decompress(p.read_bytes()).decode("utf-8").splitlines() if l and not l.startswith("#")]
        return {r["address"].upper(): {k: r.get(k) or "" for k in R.ITEM_KEYS} for r in csv.DictReader(lines)}

    def extras_format(self):
        """(format, columns) for views/singles-extras.csv: R.EXTRAS_FORMAT (2, W28 units columns) and its columns, or
        the live views/extras.csv.gz's when that one has a NEWER format (a published format 1 file does not pull the
        singles file back to format 1). Never above SINGLES_EXTRAS_MAX: format 3 (2026-11-01) only adds items_all, the
        full loot list, which the user wants for the top 100 by default and for other systems only on request."""
        p = self.repo / "views" / "extras.csv.gz"
        if p.exists():
            lines = gzip.decompress(p.read_bytes()).decode("utf-8").split("\n", 2)
            m = re.match(r"# nms-derelict-atlas extras format (\d+):", lines[0])
            if (m and R.EXTRAS_FORMAT < int(m.group(1)) <= SINGLES_EXTRAS_MAX and len(lines) > 1
                    and lines[1].startswith("address,")):
                return int(m.group(1)), lines[1].split(",")
        return R.EXTRAS_FORMAT, list(R.EXTRAS_COLUMNS)


# ======================================================================= singles store
def bucket_of(galaxy, glyphs, split):
    g = f"g{galaxy:02X}"
    if g not in split:
        return f"singles/{g}.csv"
    yy = glyphs[4:6]
    if f"{g}/{yy}" not in split:
        return f"singles/{g}/{yy}.csv"
    return f"singles/{g}/{yy}/{glyphs[6]}.csv"


def bucket_title(path):
    parts = path[len("singles/"):-4].split("/")
    gal = int(parts[0][1:], 16)
    t = f"# nms-derelict-atlas singles format {SINGLES_FORMAT}: galaxy {gal}"
    if len(parts) > 1:
        t += f" layer {parts[1]}"
    if len(parts) > 2:
        t += f" group {parts[2]}"
    return t


class Store:
    """singles/**.csv: {(galaxy, glyphs): line}; the generator line and rows of each existing file; the split state."""

    def __init__(self, repo: Path):
        self.repo, self.rows, self.files, self.split = repo, {}, {}, set()
        self.bad, self.resigned = [], 0
        man = repo / MANIFEST
        if man.exists():
            try:
                self.split = set(json.loads(man.read_text(encoding="utf-8")).get("split") or [])
            except ValueError:
                pass
        base = repo / SINGLES
        for p in sorted(base.rglob("*.csv")) if base.exists() else []:
            rel = p.relative_to(repo).as_posix()
            m = re.fullmatch(r"singles/g([0-9A-F]{2})(?:/([0-9A-F]{2})(?:/([0-9A-F]))?)?\.csv", rel)
            if not m:
                continue
            gal = int(m.group(1), 16)
            if m.group(2):
                self.split.add(f"g{m.group(1)}")       # files on disk also tell the split state
            if m.group(3):
                self.split.add(f"g{m.group(1)}/{m.group(2)}")
            lines = p.read_text(encoding="utf-8").splitlines()
            gen = next((l for l in lines if l.startswith("# generator ")), None)
            rows = [l for l in lines if R.is_row(l)]
            self.files[rel] = {"generator": gen, "rows": rows}
            fp = R.file_fingerprint(lines)
            for line in rows:
                # A row must verify with its file's '# inputs' (any known build: 7.05, 7.10, the hotfix). Rows of an
                # older stamp are re-signed with SINGLES_BUILD (body unchanged), so a bucket always has ONE
                # fingerprint; a row that does not verify is dropped and reported.
                body, _, chk = line.rpartition(",")
                if fp not in KNOWN_FPS or R.row_check(body, fp) != chk:
                    self.bad.append(rel)
                    continue
                if fp != SINGLES_FP:
                    line = f"{body},{R.row_check(body, SINGLES_FP)}"
                    self.resigned += 1
                self.rows[(gal, line.split(",", 1)[0].upper())] = line


def tier_of_line(line):
    cols = line.split(",")
    if cols[1]:
        return "detail" if cols[14] != "" else "full"
    return "pruned" if cols[14] in R.PRUNED_DIGITS else "slim"


def read_singles_extras(repo):
    p = repo / EXTRAS_SINGLES
    if not p.exists():
        return {}
    lines = [l for l in p.read_text(encoding="utf-8").splitlines() if l and not l.startswith("#")]
    return {r["address"].upper(): {k: v for k, v in r.items() if k != "address"} for r in csv.DictReader(lines)}


def read_none(repo):
    """set of ADDRESS16 in singles/none.csv."""
    p = repo / NONE_FILE
    if not p.exists():
        return set()
    return {l.strip().upper() for l in p.read_text(encoding="utf-8").splitlines()
            if V1_LINE.fullmatch(l.strip().upper())}


def none_text(addrs):
    return (f"# nms-derelict-atlas singles none format {NONE_FORMAT}: {len(addrs)} systems with no derelict (scan "
            "status 4: no abandoned freighter), each recomputed by the singles Action with the W29 scanner; "
            "key = address (ADDRESS16)\naddress\n" + "".join(a + "\n" for a in sorted(addrs)))


def read_held(repo):
    """{ADDRESS16: (first_seen, reason)} of singles/held.csv (a row without a reason = format 1 = 'range')."""
    p = repo / HELD_FILE
    out = {}
    if p.exists():
        for l in p.read_text(encoding="utf-8").splitlines():
            cells = l.strip().split(",")
            a, t = cells[0], cells[1] if len(cells) > 1 else ""
            reason = cells[2] if len(cells) > 2 else HELD_RANGE
            if V1_LINE.fullmatch(a) and a[:3] == "000" and iso(t) and reason in HELD_REASONS and len(cells) <= 3:
                out[a] = (iso(t), reason)
    return out


def held_text(held):
    return (f"# nms-derelict-atlas singles held format {HELD_FORMAT}: {len(held)} addresses not published yet, retried "
            "every run; reason status4 = the recompute found no derelict (scan status 4), which is not verified yet, "
            "retried once it is; reason range = a row of an older run, re-checked every run and dropped when the "
            "system does not exist in-game (addresses outside the region's systems are rejected, not held); "
            "first_seen = UTC time of the first batch issue that had it; at most "
            f"{HELD_MAX} (oldest dropped)\naddress,first_seen,reason\n"
            + "".join(f"{a},{held[a][0]},{held[a][1]}\n" for a in sorted(held)))


def write_small(repo, rel, text, empty, changed):
    if empty:
        remove(repo / rel, changed, rel.as_posix())
    else:
        write_if_changed(repo / rel, text, changed, rel.as_posix())


# ======================================================================= scanning (Node pool)
def load_cache(path, version):
    out = {}
    if path and Path(path).exists():
        for line in Path(path).read_text(encoding="utf-8").splitlines():
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if r.get("v") == version and isinstance(r.get("address"), str):
                out[r["address"]] = r
    return out


def _run_chunk(scan_dir, addrs, version, results, lock, fresh, deadline=None):
    """Scan addrs in one Node process; a silent Node (SYSTEM_TIMEOUT per address) costs the current address, the rest
    go on. At the deadline (epoch seconds) Node is stopped and the remaining addresses are left unscanned."""
    todo = list(addrs)
    while todo:
        if deadline is not None and time.time() >= deadline:
            return
        with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as f:
            f.write("\n".join(todo) + "\n")
            name = f.name
        p = subprocess.Popen([node_cmd(), str(NODE_HELPER), str(scan_dir), name, "--fresh", str(fresh)],
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8")
        q = queue.Queue()
        threading.Thread(target=lambda: ([q.put(l) for l in p.stdout], q.put(None)), daemon=True).start()
        threading.Thread(target=lambda: p.stderr.read(), daemon=True).start()
        first, done, stopped = True, 0, False
        try:
            last = time.time()
            while True:
                wait = SYSTEM_TIMEOUT - (time.time() - last)
                if deadline is not None:
                    wait = min(wait, deadline - time.time())
                try:
                    line = q.get(timeout=max(0.0, wait))
                except queue.Empty:
                    p.kill()
                    if deadline is not None and time.time() >= deadline and time.time() - last < SYSTEM_TIMEOUT:
                        stopped = True              # run time is up: the current address stays unscanned
                    else:
                        with lock:
                            results[todo[done]] = {"address": todo[done], "error": "timeout"}
                        done += 1
                    break
                if line is None:
                    break
                last = time.time()
                r = json.loads(line)
                if first:
                    first = False
                    if r.get("w29_version") != version:
                        raise W29Error(f"w29_version() changed during the run: {r.get('w29_version')!r}")
                    continue
                if done < len(todo) and r.get("address") == todo[done]:
                    with lock:
                        results[todo[done]] = r
                    done += 1
        finally:
            if p.poll() is None:
                p.kill()
            p.wait()
            os.unlink(name)
        if stopped:
            return
        if done == 0 and todo:          # Node died at once: mark the first address so the loop always progresses
            with lock:
                results[todo[0]] = {"address": todo[0], "error": "scanner process failed"}
            done = 1
        todo = todo[done:]


def scan_all(scan_dir, addrs, version, workers, cache_path, fresh=FRESH_EVERY, deadline=None):
    """{address: scan result} of the addresses scanned (cache first); workers parallel Node processes take chunks of
    at most CHUNK addresses in order (smaller chunks when there are few addresses, so every worker gets some).
    Addresses not reached before the deadline are missing from the result. The result does not depend on the
    number of workers (each address is scanned on its own, in a wasm instance that is fresh every `fresh` systems)."""
    cached = load_cache(cache_path, version)
    results = {a: cached[a] for a in addrs if a in cached}
    need = [a for a in addrs if a not in results]
    workers = workers if workers and workers > 0 else (os.cpu_count() or 2)
    size = max(1, min(CHUNK, -(-len(need) // workers)))
    lock, chunks = threading.Lock(), [need[i:i + size] for i in range(0, len(need), size)]
    errors = []

    def worker():
        while True:
            with lock:
                if not chunks or errors or (deadline is not None and time.time() >= deadline):
                    return
                c = chunks.pop(0)
            try:
                _run_chunk(scan_dir, c, version, results, lock, fresh, deadline)
            except Exception as exc:        # noqa: BLE001  (reported, the run stops)
                with lock:
                    errors.append(exc)
                return
    threads = [threading.Thread(target=worker) for _ in range(max(1, min(workers, len(chunks) or 1)))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    if errors:
        raise errors[0]
    if cache_path:
        with open(cache_path, "a", encoding="utf-8", newline="\n") as f:
            for a in need:
                if a in results and results[a].get("error") != "timeout":
                    f.write(json.dumps({"v": version, **results[a]}, ensure_ascii=True, sort_keys=True) + "\n")
    return results


# ======================================================================= rows + tiers
def full_line(atlas_cells, fp):
    """The region-file row of a scan: scan.exe's atlas block (glyphs .. room_detail) unchanged + check with fp."""
    body = ",".join(atlas_cells[:-1])
    return f"{body},{R.row_check(body, fp)}"


def scan_record(atlas_cells, extras):
    """The scan as a row dict (ints for the counted columns, items_value / items_nanites from the extras)."""
    r = {c: (v if v != "" else None) for c, v in zip(R.COLUMNS4[:-1], atlas_cells[:-1])}
    for k in ("frigate_modules", "crates", "footlockers", "rooms", "floors", "stairs", "hangars", "briefcases",
              "tall_lockers"):
        r[k] = None if r[k] is None or not re.fullmatch(r"-?\d+", r[k]) else int(r[k])
    for k in R.ITEM_KEYS:
        v = (extras or {}).get(k, "")
        r[k] = int(v) if re.fullmatch(r"-?\d+", v or "") else None
    return r


def single_row(atlas_cells, extras, fp, post_cap_mode, tops):
    """(line, tier, lists, record) for one scan: the scan.exe atlas block re-checked with fp, tier = R.keep_tier
    (full row below the cap; after it full only when the system breaks into a map list, else pruned)."""
    r = scan_record(atlas_cells, extras)
    tier, lists = R.keep_tier(r, post_cap_mode, tops)
    if tier in R.SLIM_TIERS:
        cells = [atlas_cells[0]] + [""] * 19
        cells[14] = R.encode(r["frigate_modules"], True) if tier == "pruned" else str(r["frigate_modules"])
        body = ",".join(cells)
        return f"{body},{R.row_check(body, fp)}", tier, lists, r
    return full_line(atlas_cells, fp), tier, lists, r


def check_scan(res, address):
    """None if the scan result is a valid published-format row for address, else the error text."""
    cells = res.get("atlas")
    if not isinstance(cells, list) or len(cells) != len(R.COLUMNS4):
        return "unexpected scan output"
    glyphs = f"0{address[3:6]}{address[8:]}"
    if cells[0].upper() != glyphs:
        return "scan output is for another system"
    body = ",".join(cells[:-1])
    if cells[-1] not in (R.row_check(body, R.FINGERPRINTS[SCAN_CHECK_BUILD]), R.row_check(body, SINGLES_FP)):
        return "scan check does not verify (wrong scanner data)"
    if any(c in v for v in cells for c in ("\r", "\n", '"')):
        return "unexpected characters in the scan output"
    return None


# ======================================================================= process
def iso(t):
    m = re.fullmatch(r"(\d{4}-\d\d-\d\d)[T ](\d\d:\d\d:\d\d)(?:\.\d+)?(?:Z|[+-]00:?00)?", str(t or ""))
    return f"{m.group(1)}T{m.group(2)}Z" if m else None


def published_tops(atlas, store, index_keys, extras_store):
    """R.top_keys over every published system: main index rows + the full singles rows of index/singles.csv, with
    the item values of views/extras.csv.gz + views/singles-extras.csv (the Most value / nanites lists)."""
    items = atlas.item_values()
    items.update({a: {k: v.get(k, "") for k in R.ITEM_KEYS} for a, v in extras_store.items()})

    def rows():
        for r in atlas.index_records():
            a = f"000{r['glyphs'][1:4]}{int(r['galaxy']):02X}{r['glyphs'][4:]}".upper()
            yield dict(r, **items.get(a, {}))
        for gal, g, line in index_rows(store, index_keys):
            rec = R.index_record(line, gal, GAME_BUILD_TAG)
            yield dict(rec, **items.get(R.address(rec), {}))
    return R.top_keys(rows())


def process(args):
    global NONE_VERIFIED
    repo = Path(args.repo).resolve()
    version = check_w29(repo)
    counts = RegionCounts()
    try:
        counts.start()                                  # W29d: pinned files + self-test before anything is read
        return _process(args, repo, version, counts)
    finally:
        counts.close()


def tables_fp(version):
    """The tables fingerprint in a w29_version() string ('...; tables fingerprint <16 hex>' since W29f, '...;
    fingerprint <16 hex>' before; never W29e's '; check fingerprint ...'), or None."""
    m = re.search(r"(?:^|; )(?:tables )?fingerprint ([0-9a-f]{16})(?=;|$)", version or "")
    return m.group(1) if m else None


def v3_cells(rec):
    """The region-file format 4 cells (glyphs .. room_detail, check placeholder) of an uploaded v3 row. room_detail is
    not uploaded: it stays empty (a rescanned row keeps the scan's)."""
    row = dict(zip(R.V3_ROW_COLS, rec["row"].split(",")))
    return [row[c] for c in R.COLUMNS4[:-2]] + ["", ""]


def v3_extras(rec):
    """The extras cells of an uploaded v3 record that views/singles-extras.csv keeps (format 2: items_all dropped)."""
    ex = dict(zip(R.V3_EXTRAS_COLS, rec["extras"].split(",")))
    return {c: ex[c] for c in R.EXTRAS_COLUMNS[1:]}


def v3_same(r1, r2):
    return all(r1.get(k) == r2.get(k) for k in ("none", "row", "extras"))


def v3_matches_store(line, rec, stored_extras):
    """True when an uploaded row equals a published singles row (every published column; a pruned / slim row: the
    module count) and no extras cell both filled differs."""
    cells = line.split(",")
    up = v3_cells(rec)
    if tier_of_line(line) in R.SLIM_TIERS:
        d = R.decode(cells[14]) if cells[14] and cells[14] in R.DIGITS + R.PRUNED_DIGITS else None
        return d is not None and str(d[0]) == up[14]
    if cells[:19] != up[:19]:
        return False
    ex = v3_extras(rec)
    return not any(ex[c] and (stored_extras or {}).get(c) and ex[c] != stored_extras[c] for c in ex)


def v3_mismatch(rec, res, a):
    """'' when our rescan res equals the uploaded record rec (every row cell except map and game_build; every extras
    cell the upload filled, except items_all, which the scanner does not write), else the reason. The reason holds
    column names and our own scan status only, never uploaded text."""
    if res.get("error"):
        return "could not be rescanned"
    if res.get("status") != 0:
        return f"the rescan found scanner status {res.get('status')}" + (" (no derelict)" if res.get("status") == 4
                                                                         else "")
    bad = check_scan(res, a)
    if bad:
        return bad
    row = dict(zip(R.V3_ROW_COLS, rec["row"].split(",")))
    scan = dict(zip(R.COLUMNS4, res["atlas"]))
    scan["glyphs"] = scan["glyphs"].upper()
    diff = [c for c in R.V3_ROW_COLS if c in scan and row[c] != scan[c]]
    ex = dict(zip(R.V3_EXTRAS_COLS, rec["extras"].split(",")))
    sx = res.get("extras") or {}
    diff += [c for c in R.V3_EXTRAS_COLS[1:] if c != "items_all" and ex[c] != "" and ex[c] != sx.get(c, "")]
    return ("differs in " + ", ".join(diff)) if diff else ""


def cell_changes(old, new, cols):
    """[[column, old, new]] of the columns whose cells differ (old / new: {column: cell})."""
    return [[c, old.get(c, ""), new.get(c, "")] for c in cols if old.get(c, "") != new.get(c, "")]


def extras_changes(old, new):
    """[[column, old, new]] of the stored extras cells (format 2) that the rescan gives differently (an empty stored
    cell that the rescan fills is not a change)."""
    old = old or {}
    return [[c, old[c], new.get(c, "")] for c in R.EXTRAS_COLUMNS[1:] if old.get(c) and old[c] != new.get(c, "")]


def scan_extras(res):
    return {k: ("" if v == "ERR" else v) for k, v in (res.get("extras") or {}).items()}


def _process(args, repo, version, region_counts):
    global NONE_VERIFIED
    if args.none_verified:                              # tests only: the flag forced on
        NONE_VERIFIED = True
    if args.atlas_cap is not None:                      # tests only: a lowered cap
        R.ATLAS_CAP = args.atlas_cap
    atlas, store = Atlas(repo, region_counts), Store(repo)
    every = usable_issues(json.loads(Path(args.issues_file).read_text(encoding="utf-8")))
    issues = [it for it in every if REPORT_LABEL not in label_names(it)]
    reports = [it for it in every if REPORT_LABEL in label_names(it) and REPORT_PC_LABEL not in label_names(it)]
    index_keys = atlas.index()
    nones, held = read_none(repo), read_held(repo)
    # ---- region supersede: a single whose system now has a region row / slim entry leaves singles (a main index
    #      row does NOT: the PC folds singles into the main index, singles/ stays their source) ----
    superseded, mismatch = [], []
    for (gal, g), line in sorted(store.rows.items()):
        info, idx = atlas.region(gal, g[4:]), int(g[1:4], 16)
        reg_line = info["rows"].get(g) if info else None
        if reg_line is not None or (info and idx in info["slim"]):
            superseded.append(R.address({"glyphs": g, "galaxy": gal}))
            if reg_line is not None and tier_of_line(line) in ("detail", "full") and \
                    reg_line.rpartition(",")[0] != line.rpartition(",")[0]:
                mismatch.append(R.address({"glyphs": g, "galaxy": gal}))
            del store.rows[(gal, g)]
    total = args.community_total if args.community_total is not None else atlas.total()
    community = None if total is None else total + sum(1 for k in store.rows if k not in index_keys)
    running, cap_seen, tops = community, False, None
    fp = R.FINGERPRINTS[SINGLES_BUILD]
    extras_store = read_singles_extras(repo)
    for a in superseded:
        extras_store.pop(a, None)
    live_fp = tables_fp(version)
    fps_ok = ({live_fp} if live_fp else set()) | set(V3_EXTRA_FPS)
    toplist_rescan = R.post_cap(community)              # V3: rescan uploads that enter a top list, only after 1M
    plan_tops = []

    def classify(a):
        """('already' | 'invalid' | 'nonexistent' | 'held' | 'scan', detail)."""
        gal, region, idx = int(a[6:8], 16), a[8:], int(a[3:6], 16)
        glyphs = f"0{a[3:6]}{region}"
        info = atlas.region(gal, region)
        if not 1 <= idx <= 0xFFF:
            return "invalid", "no such system index"
        if info and glyphs in info["rows"]:
            return "already", "region file"
        if info and idx in info["slim"]:
            return "already", "region file (module count only)"
        if (gal, glyphs) in index_keys:
            return "already", "atlas index"
        if (gal, glyphs) in store.rows:
            return "already", "singles"
        if a in nones:
            return "already", "no derelict (singles/none.csv)"
        if a in held and held[a][1] == HELD_STATUS4 and not NONE_VERIFIED:
            return "held", HELD_DETAIL[HELD_STATUS4]          # not scanned again until status 4 is verified
        if not atlas.known(a):          # W29DW-3 (user: "drop them"): never valid later -> rejected with the reason
            return "nonexistent", f"{NONEXISTENT} ({region_counts.nonexistent_reason(gal, region, idx)})"
        return "scan", ("deferred" if info and idx in info["deferred"] else None)

    def locate(a):
        """Where the system is published: 'region' | 'slim' | 'singles' | 'index' | None."""
        gal, region, idx = int(a[6:8], 16), a[8:], int(a[3:6], 16)
        glyphs, info = f"0{a[3:6]}{region}", atlas.region(gal, region)
        if info and glyphs in info["rows"]:
            return "region"
        if info and idx in info["slim"]:
            return "slim"
        if (gal, glyphs) in store.rows:
            return "singles"
        if (gal, glyphs) in index_keys:
            return "index"
        return None

    # ---- take issues up to the run caps (MAX_PER_RUN = addresses to scan), classify every address ----
    taken, wait, first_issue, cls, to_scan, origin, n_scan, claim_none = [], [], {}, {}, [], {}, 0, set()
    v3_claim, v3_entry = {}, {}         # address -> record of its first v3 issue; issue number -> taken entry

    def take_v3(it, p):
        """Plan a v3 batch (format / range / consistency already checked by parse_issue): per address 'publish'
        (the upload as it is), 'verify' (rescan: the 1 % sample, after the cap a top-list entry, or a conflict),
        'compare' (rescan: differs from another upload of this run or from the published single, or held), 'none'
        (recomputed like a v2 'none'), 'final' (already / invalid / nonexistent) or 'duplicate'."""
        nonlocal n_scan
        num = it["number"]
        entry = {"it": it, "addrs": [], "none": set(), "bad": 0, "over": 0, "scanners": p["scanners"], "format": "v3",
                 "plan": {}, "records": {}, "reject": p["error"], "state": None, "reason": None}
        recs = {}
        if entry["reject"] is None:
            items = list(p["records"].items())
            entry["over"] = max(0, len(items) - MAX_PER_ISSUE)
            recs = dict(items[:MAX_PER_ISSUE])
            bad_fp = sorted({r["fp"] for r in recs.values()} - fps_ok)
            if bad_fp:
                entry["reject"] = (f"scanner tables fingerprint {', '.join(bad_fp)} is not the live scanner's "
                                   f"({live_fp or 'none'})")
        if entry["reject"] is not None:
            taken.append(entry)
            return
        plan, local, scans, upgrade = {}, {}, [], []
        fresh = [a for a in recs if a not in first_issue]
        for a, rec in recs.items():
            if a in first_issue:                        # claimed by an earlier issue of this run
                if a in v3_claim and v3_same(v3_claim[a], rec):
                    plan[a] = ("duplicate", first_issue[a])
                elif not rec.get("none") and (a in origin or cls[a][0] == "scan"):
                    plan[a] = ("compare", "conflict with issue #%d" % first_issue[a])
                    scans.append(a)
                    if a in v3_claim:
                        upgrade.append(a)
                else:
                    plan[a] = ("duplicate", first_issue[a])
                continue
            c = cls.get(a) or classify(a)
            local[a] = c
            if rec.get("none"):
                plan[a] = ("none", None)
                if c[0] == "scan":
                    scans.append(a)
            elif c == ("already", "singles"):
                key = (int(a[6:8], 16), f"0{a[3:6]}{a[8:]}")
                if v3_matches_store(store.rows[key], rec, extras_store.get(a)):
                    plan[a] = ("final", None)
                else:
                    plan[a] = ("compare", "differs from the published single")
                    scans.append(a)
            elif c[0] == "held":
                plan[a] = ("compare", "held: an earlier recompute found no derelict")
                scans.append(a)
            elif c[0] == "scan":
                plan[a] = ("publish", None)
            else:
                plan[a] = ("final", None)
        cands = sorted(a for a, (k, _) in plan.items() if k == "publish")
        if cands:
            n = max(1, -(-len(cands) * V3_SAMPLE_PERCENT // 100))
            for a in random.Random(f"singles-v3-sample/{num}").sample(cands, n):
                plan[a] = ("verify", "sample")
                scans.append(a)
            if toplist_rescan:
                if not plan_tops:
                    plan_tops.append(published_tops(atlas, store, index_keys, extras_store))
                for a in cands:
                    if plan[a][0] == "publish" and \
                            R.breaks_into(scan_record(v3_cells(recs[a]), v3_extras(recs[a])), plan_tops[0]):
                        plan[a] = ("verify", "top list")
                        scans.append(a)
        new_scans = [a for a in dict.fromkeys(scans) if a not in origin]
        if taken and n_scan + len(new_scans) > MAX_PER_RUN:
            wait.append(num)
            return
        n_scan += len(new_scans)
        for a in new_scans:
            to_scan.append(a)
            origin[a] = num
        for a in fresh:
            first_issue[a] = num
            cls[a] = local[a]
            v3_claim[a] = recs[a]
            if recs[a].get("none"):
                claim_none.add(a)
            if cls[a][0] in ("already", "invalid", "nonexistent"):
                held.pop(a, None)
        for a in upgrade:
            owner = v3_entry.get(first_issue[a])
            if owner and owner["plan"][a][0] == "publish":
                owner["plan"][a] = ("verify", "conflict with issue #%d" % num)
        entry.update(addrs=list(recs), plan=plan, records=recs, none={a for a in recs if recs[a].get("none")})
        taken.append(entry)
        v3_entry[num] = entry

    for it in issues:
        p = parse_issue(it.get("title"), it.get("body"))
        if p["format"] == "v3":
            take_v3(it, p)
            continue
        over = max(0, len(p["addrs"]) - MAX_PER_ISSUE)
        addrs = p["addrs"][:MAX_PER_ISSUE]
        new = [a for a in addrs if a not in first_issue]
        for a in new:
            if a not in cls:
                cls[a] = classify(a)
        n_new = sum(1 for a in new if cls[a][0] == "scan")
        if taken and n_scan + n_new > MAX_PER_RUN:
            wait.append(it["number"])
            continue
        n_scan += n_new
        for a in new:
            first_issue[a] = it["number"]
            if a in p["none"]:
                claim_none.add(a)
            if cls[a][0] in ("already", "invalid", "nonexistent"):
                held.pop(a, None)
            if cls[a][0] == "scan":
                to_scan.append(a)
                origin[a] = it["number"]
        taken.append({"it": it, "addrs": addrs, "none": p["none"], "bad": p["bad"], "over": over,
                      "scanners": p["scanners"], "format": p["format"]})
    run_utc = iso(args.utc) or max((iso(t.get("created_at")) or NO_TIME for t in [t["it"] for t in taken] + reports),
                                   default=NO_TIME)
    # ---- held addresses: retried every run (after the issues, inside the run cap); old 'range' rows of systems that
    #      do not exist in-game are dropped (W29DW-3) ----
    held_dropped, held_nonexistent = [], []
    for a in sorted(held, key=lambda x: (held[x][0], x)):
        if a in first_issue:
            continue
        c = classify(a)
        if c[0] in ("already", "invalid", "nonexistent"):
            (held_nonexistent if c[0] == "nonexistent" else held_dropped).append(a)
            del held[a]
        elif c[0] == "scan" and n_scan < MAX_PER_RUN:
            n_scan += 1
            to_scan.append(a)
            origin[a] = "held"
            cls[a] = c
    issue_time = {t["it"]["number"]: iso(t["it"].get("created_at")) or run_utc for t in taken}
    for t in taken:                                     # new held addresses (earliest batch time wins)
        for a in t["addrs"]:
            if first_issue[a] == t["it"]["number"] and cls[a][0] == "held":
                held[a] = (min((held.get(a) or ("9999",))[0], issue_time[t["it"]["number"]]), HELD_STATUS4)
    # ---- report-system issues (at most REPORT_MAX per run, oldest first): the reported address is rescanned ----
    report_plan, report_wait = {}, []
    for it in reports:
        num = it["number"]
        if len(report_plan) >= REPORT_MAX:
            report_wait.append(num)
            continue
        title = it.get("title") if isinstance(it.get("title"), str) else ""
        m = re.fullmatch(r"[ \t]*([0-9A-Fa-f]{16})[ \t]*", title[:100])
        a = m.group(1).upper() if m and m.group(1)[:3] == "000" else None
        if a is None:
            report_plan[num] = {"result": "bad_title"}
            continue
        gal, region, idx = int(a[6:8], 16), a[8:], int(a[3:6], 16)
        if not 1 <= idx <= 0xFFF:
            report_plan[num] = {"address": a, "result": "invalid", "detail": "no such system index"}
            continue
        if locate(a) is None and not atlas.known(a):
            report_plan[num] = {"address": a, "result": "nonexistent",
                                "detail": f"{NONEXISTENT} ({region_counts.nonexistent_reason(gal, region, idx)})"}
            continue
        report_plan[num] = {"address": a, "result": None}
        if a not in origin:
            to_scan.append(a)
            origin[a] = "report"
    # ---- scan ----
    deadline = args.deadline
    results = scan_all(repo / SCAN_DIR, to_scan, version, args.workers, args.cache, deadline=deadline) \
        if to_scan else {}
    # ---- v3 batches: every rescan must equal the upload, or the WHOLE batch is dropped ----
    for t in taken:
        if t["format"] != "v3":
            continue
        if t["reject"] is not None:
            t["state"], t["reason"] = "rejected", t["reject"]
            continue
        fails, pend = [], False
        for a, (k, why) in t["plan"].items():
            if k not in ("verify", "compare"):
                continue
            if results.get(a) is None:
                pend = True
                continue
            d = v3_mismatch(t["records"][a], results[a], a)
            if d:
                fails.append(f"`{a}` ({why}): {d}")
        if fails:
            t["state"] = "dropped"
            t["reason"] = "rescan mismatch: " + "; ".join(fails[:5]) + (f" (+{len(fails) - 5} more)"
                                                                         if len(fails) > 5 else "")
        else:
            t["state"] = "pending" if pend else "ok"
    v3_nums = {t["it"]["number"] for t in taken if t["format"] == "v3"}
    accepted, new_none, outcome, pending, reported_none_found = [], [], {}, [], 0
    acc_o, published_now = {}, set()

    def accept(a, cells, extras, o, new=True):
        """Publish one system (scan cells or an uploaded row): tier by the cap rule, row into the store, extras."""
        nonlocal running, cap_seen, tops
        cap_mode = R.post_cap(running)
        if cap_mode and tops is None:
            tops = published_tops(atlas, store, index_keys, extras_store)
        cap_seen |= cap_mode
        line, tier, lists, rec = single_row(cells, extras, fp, cap_mode, tops)
        gal, glyphs = int(a[6:8], 16), cells[0].upper()
        store.rows[(gal, glyphs)] = line
        o.update(outcome="accepted", tier=tier, **({"lists": lists} if lists else {}))
        if tier not in R.SLIM_TIERS:
            ex = {k: ("" if v == "ERR" else v) for k, v in (extras or {}).items()}
            if any(v != "" for v in ex.values()):
                extras_store[a] = ex
            elif not new:
                extras_store.pop(a, None)
            if tops is not None:
                R.add_to_tops(rec, tops)
        if running is not None and new:
            running += 1
        held.pop(a, None)
        accepted.append(a)
        acc_o[a] = o
        published_now.add(a)

    def scan_outcome(a, o, claimed_none):
        """The outcome of a recomputed address (v1 / v2 addresses, held retries, v3 'none' claims)."""
        nonlocal reported_none_found
        res = results.get(a)
        if cls[a][1] == "deferred":
            o["deferred"] = True
        if res is None:                                 # run time was up: next run (issue stays open / stays held)
            o.update(outcome="pending")
            pending.append(a)
            return
        prev = held.pop(a, None)
        if res.get("error"):
            o.update(outcome="error", detail=res["error"])
        elif res.get("status") == 4 and not NONE_VERIFIED:   # unverified status 4: held, never rejected
            o.update(outcome="held", detail=HELD_DETAIL[HELD_STATUS4])
            held[a] = (prev[0] if prev else issue_time.get(origin[a], run_utc), HELD_STATUS4)
        elif res.get("status") == 4:
            o.update(outcome="no_derelict")
            nones.add(a)
            new_none.append(a)
        elif res.get("status") != 0:
            o.update(outcome="error", detail=f"scanner status {res.get('status')}")
        elif check_scan(res, a):
            o.update(outcome="error", detail=check_scan(res, a))
        else:
            accept(a, res["atlas"], res.get("extras"), o)
            if claimed_none:
                o["reported"] = "none"
                reported_none_found += 1

    for a in to_scan:
        if origin[a] == "report" or origin[a] in v3_nums:
            continue                                    # v3 batches and reports: below
        scan_outcome(a, outcome.setdefault(a, {}), a in claim_none)
    v3_out, rescans = {}, {}
    for t in taken:
        if t["format"] != "v3":
            continue
        num, lst, st = t["it"]["number"], [], t["state"]
        for a in t["addrs"]:
            k, why = t["plan"][a]
            o = {"address": a}
            if st in ("dropped", "pending"):            # nothing of a dropped / unfinished batch is published
                o["outcome"] = st
            elif k == "duplicate":
                o.update(outcome="duplicate", detail=f"also in issue #{why}")
            elif k == "final" or (k == "none" and cls[a][0] != "scan"):
                o.update(outcome=cls[a][0], **({"detail": cls[a][1]} if cls[a][1] else {}))
            elif a in published_now:
                o.update(outcome="duplicate", detail=f"also in issue #{first_issue[a]}" if first_issue[a] != num
                         else "published once")
            elif k == "none":
                scan_outcome(a, o, True)
            elif k == "publish":
                accept(a, v3_cells(t["records"][a]), v3_extras(t["records"][a]), o)
            else:                                       # verify / compare: the rescan equals the upload
                key = (int(a[6:8], 16), f"0{a[3:6]}{a[8:]}")
                old = key in store.rows
                accept(a, results[a]["atlas"], results[a].get("extras"), o, new=not old)
                o["verified"] = why
                rescans[why.split(" with ")[0]] = rescans.get(why.split(" with ")[0], 0) + 1
                if old:
                    o["replaced"] = True
            lst.append(o)
        v3_out[num] = lst
    # ---- report-system issues: compare the rescan with the published row ----
    rep_out = []
    pc_keys = {}
    for num, rp in report_plan.items():
        if rp.get("result") is None and locate(rp["address"]) == "index":
            a = rp["address"]
            pc_keys[(int(a[6:8], 16), f"0{a[3:6]}{a[8:]}")] = None
    if pc_keys:
        for r in atlas.index_records():
            k = (int(r["galaxy"]), r["glyphs"].upper())
            if k in pc_keys:
                pc_keys[k] = r
    rep_time = {it["number"]: iso(it.get("created_at")) or run_utc for it in reports}
    for num, rp in report_plan.items():
        e = {"number": num, "kind": "report", "address": rp.get("address"), "close": True, "changes": []}
        rep_out.append(e)
        if rp.get("result") is not None:
            e.update(result=rp["result"], detail=rp.get("detail"))
            continue
        a = rp["address"]
        gal, region, idx = int(a[6:8], 16), a[8:], int(a[3:6], 16)
        key = (gal, f"0{a[3:6]}{region}")
        res, where = results.get(a), locate(a)
        e["where"] = where
        if res is None:
            e.update(result="pending", close=False)
            continue
        status = res.get("status")
        if res.get("error") or status not in (0, 4) or (status == 0 and check_scan(res, a)):
            e.update(result="error", detail=res.get("error") or (check_scan(res, a) if status == 0
                                                                  else f"scanner status {status}"))
            continue
        if where is None:
            if status == 4:
                e.update(result="no_derelict", detail="the rescan found no derelict (scan status 4)")
                if NONE_VERIFIED:
                    nones.add(a)
                    new_none.append(a)
                else:
                    held[a] = (held[a][0] if a in held else rep_time[num], HELD_STATUS4)
            else:
                o = {}
                accept(a, res["atlas"], res.get("extras"), o)
                e.update(result="published", tier=o["tier"])
            continue
        if status == 4:
            e.update(result="differs", close=False, add_label=REPORT_PC_LABEL,
                     detail="the rescan found no derelict (scan status 4), the atlas has one")
            continue
        scan = dict(zip(R.COLUMNS4, res["atlas"]))
        if where == "singles" or where == "slim":
            line = store.rows[key] if where == "singles" else None
            if where == "slim" or tier_of_line(line) in R.SLIM_TIERS:
                ch = atlas.region(gal, region)["slim"][idx] if where == "slim" else line.split(",")[14]
                d = R.decode(ch)
                old = {"frigate_modules": str(d[0]) if d else ""}
                changes = cell_changes(old, scan, ["frigate_modules"])
            else:
                old = dict(zip(R.COLUMNS4, line.split(",")))
                changes = cell_changes(old, scan, R.COLUMNS4[1:-2]) + \
                    extras_changes(extras_store.get(a), scan_extras(res))
        elif where == "region":
            old = dict(zip(R.COLUMNS4, atlas.region(gal, region)["rows"][key[1]].split(",")))
            changes = cell_changes(old, scan, R.COLUMNS4[1:-2])
        else:                                           # main index row (no region row, not a single)
            old = pc_keys.get(key) or {}
            changes = cell_changes(old, scan, [c for c in R.V3_ROW_COLS if c in R.COLUMNS4[1:-2]])
        e["changes"] = changes
        if not changes:
            e.update(result="verified")
        elif where == "singles":
            o = {}
            if tier_of_line(store.rows[key]) in R.SLIM_TIERS:
                cells = store.rows[key].split(",")[:-1]
                m = int(scan["frigate_modules"])
                cells[14] = R.encode(m, True) if tier_of_line(store.rows[key]) == "pruned" else str(m)
                store.rows[key] = f"{','.join(cells)},{R.row_check(','.join(cells), fp)}"
            else:
                accept(a, res["atlas"], res.get("extras"), o, new=False)
            e.update(result="replaced")
        else:
            e.update(result="differs", close=False, add_label=REPORT_PC_LABEL)
    # ---- FINDER1: report reason "name" needs a human: label report-pc, left open ----
    name_flag = {it["number"]: report_names_finder(it.get("body")) for it in reports}
    for e in rep_out:
        if name_flag.get(e["number"]) and e.get("address") and e["result"] not in ("pending", "bad_title", "invalid",
                                                                                    "nonexistent"):
            e.update(name_reported=True, close=False, add_label=REPORT_PC_LABEL)
    # ---- FINDER1: views/finders.csv (first finder per published single) + the perf of accepted v3 issues ----
    block_addr, block_name = read_finder_block(repo)
    finders = read_finders(repo)
    f_stats = {"added": 0, "blocked": 0, "not_single": 0, "name_blocked": 0}
    for a in list(finders):
        if a in block_addr or finders[a][0].casefold() in block_name:
            del finders[a]
            f_stats["blocked"] += 1
        elif locate(a) != "singles":                    # the PC atlas has it now (or it is gone): never a finder
            del finders[a]
            f_stats["not_single"] += 1
    perfs = []
    for t in taken:
        if t["format"] != "v3" or t["state"] != "ok":
            continue
        num = t["it"]["number"]
        perfs += [r["perf"] for r in t["records"].values() if "perf" in r]
        for o in v3_out[num]:
            a = o["address"]
            name = t["records"].get(a, {}).get("finder")
            if not name or o["outcome"] != "accepted" or o.get("replaced") or a in finders or locate(a) != "singles":
                continue
            if a in block_addr or name.casefold() in block_name:
                f_stats["name_blocked"] += 1
                continue
            finders[a] = (name, issue_time[num])
            f_stats["added"] += 1
    # ---- none.csv: never an address that has a row anywhere; held.csv: capped, oldest dropped ----
    for a in sorted(nones):
        gal, glyphs = int(a[6:8], 16), f"0{a[3:6]}{a[8:]}"
        info = atlas.region(gal, a[8:])
        if (gal, glyphs) in store.rows or (gal, glyphs) in index_keys or (info and glyphs in info["rows"]):
            nones.discard(a)
    held_over = []
    if len(held) > HELD_MAX:
        held_over = sorted(held, key=lambda x: (held[x][0], x))[:len(held) - HELD_MAX]
        for a in held_over:
            del held[a]
    # ---- write ----
    changed = []
    paths = write_store(repo, store, run_utc, version, args.split_bytes, changed)
    for a in accepted:
        acc_o[a]["file"] = bucket_of(int(a[6:8], 16), f"0{a[3:6]}{a[8:]}", store.split)
    for e in rep_out:
        if e.get("result") in ("published", "replaced"):
            e["file"] = bucket_of(int(e["address"][6:8], 16), f"0{e['address'][3:6]}{e['address'][8:]}", store.split)
    rank_before = RK.snapshot(repo)             # RANK1: bytes before this run writes (for `changed`)
    n_index = write_index(repo, atlas, store, index_keys, changed)
    write_extras(repo, atlas, store, index_keys, extras_store, changed)
    try:        # RANK1: the singles rank in the 15 map lists like atlas rows (map-lists.txt, stats map_lists, map column)
        rank = RK.apply(repo, changed, rank_before)
    except Exception as exc:    # never blocks the singles; the PC publish ranks them too
        rank = {"ranked": False, "error": f"{type(exc).__name__}: {exc}"[:300]}
        print(f"map-list re-rank skipped: {rank['error']}")
    write_small(repo, NONE_FILE, none_text(nones), not nones, changed)
    write_small(repo, HELD_FILE, held_text(held), not held, changed)
    write_small(repo, FINDERS_FILE, finders_text(finders), not finders, changed)
    n_speed = update_speed(repo, perfs, run_utc, changed)
    # ---- summary ----
    counts = {k: 0 for k in ("accepted", "already", "no_derelict", "invalid", "nonexistent", "error", "over_cap",
                             "duplicate", "held", "pending", "dropped", "rejected")}
    out_issues, scanners = [], {}
    for t in taken:
        num, lst = t["it"]["number"], []
        if t["format"] == "v3":
            lst = v3_out[num] if t["state"] != "rejected" else []
            for x in lst:
                counts[x["outcome"]] += 1
            if t["state"] == "rejected":
                counts["rejected"] += 1                 # whole issues (its records are not counted)
            counts["over_cap"] += t["over"]
            for tok in t["scanners"]:
                scanners[tok] = scanners.get(tok, 0) + 1
            out_issues.append({"number": num, "format": "v3", "addresses": lst, "invalid_matches": 0,
                               "over_cap": t["over"], "scanners": t["scanners"],
                               "pending": len(lst) if t["state"] == "pending" else 0,
                               "close": t["state"] != "pending", "v3_state": t["state"], "v3_reason": t["reason"],
                               "v3_rescans": {a: why for a, (k, why) in t["plan"].items()
                                              if k in ("verify", "compare")}})
            continue
        for a in t["addrs"]:
            if first_issue[a] != num:
                lst.append({"address": a, "outcome": "duplicate", "detail": f"also in issue #{first_issue[a]}"})
            elif a in outcome:
                lst.append({"address": a, **outcome[a]})
            else:
                k, d = cls[a]
                lst.append({"address": a, "outcome": k, **({"detail": d} if d else {})})
            counts[lst[-1]["outcome"]] += 1
        counts["invalid"] += t["bad"]
        counts["over_cap"] += t["over"]
        for tok in t["scanners"]:
            scanners[tok] = scanners.get(tok, 0) + 1
        open_left = sum(1 for x in lst if x["outcome"] == "pending")
        out_issues.append({"number": num, "format": t["format"], "addresses": lst, "invalid_matches": t["bad"],
                           "over_cap": t["over"], "scanners": t["scanners"], "pending": open_left,
                           "close": open_left == 0})
    out_issues += rep_out
    v3_taken = [t for t in taken if t["format"] == "v3"]
    msg = f"singles: {len(accepted)} systems, {len(new_none)} without a derelict (run {args.run_id})"
    summary = {"format": 2, "run_id": args.run_id, "w29_version": version, "run_utc": run_utc,
               "community_total": community, "cap_mode": cap_seen or R.post_cap(community), "atlas_cap": R.ATLAS_CAP,
               "counts": counts,
               "tiers": {k: sum(1 for a in accepted if acc_o[a]["tier"] == k) for k in ("detail", "full", "slim", "pruned")},
               "reported_none_found": reported_none_found, "scanners": scanners,
               "singles_rows": len(store.rows), "store_resigned": store.resigned, "store_bad_rows": store.bad,
               "build": SINGLES_BUILD, "index_rows": n_index, "none_rows": len(nones), "held_rows": len(held),
               "none_verified": NONE_VERIFIED,
               "held_reasons": {r: sum(1 for v in held.values() if v[1] == r) for r in HELD_REASONS},
               "held_retried": sum(1 for a in to_scan if origin[a] == "held"), "held_dropped": held_dropped,
               "held_nonexistent_dropped": held_nonexistent,
               "held_over_cap": held_over, "pending": pending, "files": paths,
               "work_list": {"regions": len(atlas.work()[0]), "ignored_lines": atlas.work()[1]},
               "region_counts": region_counts.computed,
               "portal_checks": region_counts.purple_computed,
               "superseded": superseded, "superseded_mismatch": mismatch, "waiting_issues": wait,
               "v3": {"tables_fp": live_fp, "toplist_rescan": toplist_rescan,
                      "issues": {s: sum(1 for t in v3_taken if t["state"] == s)
                                 for s in ("ok", "dropped", "rejected", "pending")},
                      "rescans": {a: why for t in v3_taken for a, (k, why) in t["plan"].items()
                                  if k in ("verify", "compare")}, "verified": rescans},
               "reports": {r: sum(1 for e in rep_out if e["result"] == r) for r in REPORT_RESULTS},
               "report_waiting": report_wait,
               "changed": sorted(set(changed)), "commit_message": msg, "issues": out_issues}
    summary["finders"] = dict(f_stats, total=len(finders))
    summary["speed_batches"] = n_speed
    summary["reports_name"] = sum(1 for e in rep_out if e.get("name_reported"))
    summary["rerank"] = rank                   # RANK1
    Path(args.summary).write_text(json.dumps(summary, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    if args.message:
        Path(args.message).write_text(msg + "\n", encoding="utf-8")
    print(f"{msg}: {json.dumps(counts, sort_keys=True)}; {len(superseded)} superseded; {len(pending)} left for the "
          f"next run; scanners {json.dumps(scanners, sort_keys=True)}; {len(set(changed))} files changed; v3 issues "
          f"{json.dumps(summary['v3']['issues'], sort_keys=True)}; reports {json.dumps(summary['reports'], sort_keys=True)}")
    return summary


def write_store(repo, store, run_utc, version, split_bytes, changed):
    """Bucket files (adaptive split, never merged back), manifest; returns {path: rows}."""
    fp = R.FINGERPRINTS[SINGLES_BUILD]
    gen_new = (f"# generator singles-action {SINGLES_FORMAT} ({version.replace(';', ',')}); "
               f"NMS.exe {SINGLES_BUILD} SHA-256 {R.EXE_SHAS[SINGLES_BUILD]}; {run_utc}")
    while True:
        buckets = {}
        for (gal, g), line in store.rows.items():
            buckets.setdefault(bucket_of(gal, g, store.split), []).append(line)
        texts = {}
        for path, rows in buckets.items():
            rows.sort(key=lambda l: l.split(",", 1)[0].upper())
            old = store.files.get(path)
            gen = old["generator"] if old and old["generator"] and old["rows"] == rows else gen_new
            texts[path] = "\n".join([bucket_title(path), gen, f"# inputs {fp}", R.HEADER4, *rows]) + "\n"
        grow = []
        for path, text in texts.items():
            depth = path.count("/")
            if len(text.encode("utf-8")) > split_bytes and depth < 3:
                grow.append(path[len("singles/"):-4])
        if not grow:
            break
        store.split.update(grow)
    for path in sorted(set(store.files) - set(texts)):
        remove(repo / path, changed, path)
    for path, text in sorted(texts.items()):
        write_if_changed(repo / path, text, changed, path)
    for d in sorted((p for p in (repo / SINGLES).rglob("*") if p.is_dir()), key=lambda p: -len(p.parts)) \
            if (repo / SINGLES).exists() else []:
        if not any(d.iterdir()):
            d.rmdir()
    if texts:
        files = [{"path": p, "rows": texts[p].count("\n") - 4, "bytes": len(texts[p].encode("utf-8")),
                  "sha256": hashlib.sha256(texts[p].encode("utf-8")).hexdigest()} for p in sorted(texts)]
        doc = {"format": SINGLES_FORMAT, "rows": len(store.rows), "split": sorted(store.split), "files": files}
        write_if_changed(repo / MANIFEST, json.dumps(doc, separators=(",", ":")) + "\n", changed, MANIFEST.as_posix())
    else:
        remove(repo / MANIFEST, changed, MANIFEST.as_posix())
    return {p: texts[p].count("\n") - 4 for p in sorted(texts)}


def index_rows(store, index_keys):
    """Store rows that become index rows: full rows (detail / full tier) not in the main index; (galaxy, glyphs) order."""
    out = []
    for (gal, g), line in sorted(store.rows.items()):
        if (gal, g) not in index_keys and tier_of_line(line) in ("detail", "full"):
            out.append((gal, g, line))
    return out


def write_index(repo, atlas, store, index_keys, changed):
    head = atlas.index_head()
    if not head:        # no main index at all: build_atlas_index's column header (mixed form), own '#' line
        head = ["# nms-derelict-atlas index format 6: singles only",
                ",".join(R.INDEX_COLUMNS + R.INDEX_EXTRA + R.INDEX_REWARD + R.INDEX_FRIGATE + ["game_build"])]
    cols = head[1].split(",")
    names = R.INDEX_COLUMNS + R.INDEX_EXTRA + R.INDEX_REWARD + R.INDEX_FRIGATE + ["game_build"]
    out = io.StringIO(newline="")
    out.write(head[0] + "\n" + head[1] + "\n")
    w = csv.writer(out, lineterminator="\n")
    rows = index_rows(store, index_keys)
    for gal, g, line in rows:
        cells = dict(zip(names, R.index_cells(R.index_record(line, gal, GAME_BUILD_TAG), 0, True)))
        w.writerow([cells.get(c, "") for c in cols])
    if rows:
        write_if_changed(repo / INDEX_SINGLES, out.getvalue(), changed, INDEX_SINGLES.as_posix())
    else:
        remove(repo / INDEX_SINGLES, changed, INDEX_SINGLES.as_posix())
    return len(rows)


def write_extras(repo, atlas, store, index_keys, extras_store, changed):
    fmt, cols = atlas.extras_format()
    keep = {R.address({"glyphs": g, "galaxy": gal}) for gal, g, _ in index_rows(store, index_keys)}
    values = {a: v for a, v in extras_store.items() if a in keep}
    if values:
        text = R.extras_text(values, cols, fmt, "item value (units) and nanites per system and the SpookBox of the "
                             "visitor-scanned single systems in index/singles.csv (W29 scanner, cells as scan.exe "
                             "--spook --items writes them); key = address (ADDRESS16); empty = not computed; "
                             "items_units = money (Units) per system (RE_FULL W28; empty for scans made before W29e)")
        write_if_changed(repo / EXTRAS_SINGLES, text, changed, EXTRAS_SINGLES.as_posix())
    else:
        remove(repo / EXTRAS_SINGLES, changed, EXTRAS_SINGLES.as_posix())


# ======================================================================= comments
NAMES = {"accepted": "published", "already": "already in the atlas",
         "no_derelict": "no derelict in this system (recorded in singles/none.csv)", "invalid": "not a valid system",
         "nonexistent": NONEXISTENT, "held": "held", "error": "could not be scanned",
         "duplicate": "also in another issue"}
COMMENT_LIST = 100              # addresses listed per comment line (a 3,000-address batch stays far below 65,536 chars)


def _short(v, n=60):
    v = str(v)
    return v if len(v) <= n else v[:n] + "..."


def report_text(run_id, e):
    """The comment of a report-system issue (+ the FINDER1 "name" sentence when the report lists reason name)."""
    t = _report_text(run_id, e)
    if e.get("name_reported"):
        t = re.sub(r" Closed(?:;[^.]*)?\.\Z", "", t)
        t += " Finder name reported; the atlas owner checks it (tools/singles/finder_block.txt)."
        if f"label `{REPORT_PC_LABEL}`" not in t:
            t += f" Left open (label `{REPORT_PC_LABEL}`)."
    return t


def _report_text(run_id, e):
    """The comment of a report-system issue. Only our own data: the parsed address, published rows, our rescan."""
    a, r = e.get("address"), e["result"]
    head = f"Automatic report check (run {run_id})"
    ch = "; ".join(f"{c}: {_short(o) or '(empty)'} -> {_short(n) or '(empty)'}" for c, o, n in e.get("changes")[:20])
    if r == "bad_title":
        return (f"{head}: the title must be exactly one system address (16 hex digits, as the atlas shows it), "
                "nothing else. Closed; please open a new report with the address as the title.")
    if r in ("invalid", "nonexistent"):
        return f"{head}: `{a}` {e.get('detail') or 'is not a valid system'}. Closed."
    if r == "error":
        return f"{head}: `{a}` could not be rescanned ({_short(e.get('detail'), 120)}). Closed; please report again later."
    if r == "no_derelict":
        return f"{head}: `{a}` was rescanned with the site's scanner: {e.get('detail')}. Nothing published. Closed."
    if r == "published":
        return (f"{head}: `{a}` was not in the atlas; the rescan found a derelict and it is now published "
                f"({e.get('file')}). Closed.")
    if r == "verified":
        return f"{head}: `{a}` was rescanned with the site's scanner: verified, no change. Closed."
    if r == "replaced":
        return f"{head}: `{a}` was rescanned; the published single differed and was replaced: {ch}. Closed."
    return (f"{head}: `{a}` was rescanned; the PC atlas row differs from the rescan: "
            f"{ch or e.get('detail')}. Left open for the scanner agent (label `{REPORT_PC_LABEL}`).")


def comment_text(run_id, issue):
    if issue.get("kind") == "report":
        return report_text(run_id, issue)
    if issue.get("v3_state") in ("dropped", "rejected"):
        return (f"Automatic singles check (run {run_id}): this v3 batch was {issue['v3_state']}: {issue['v3_reason']}. "
                "Nothing of it was published (one rescan mismatch or one invalid record drops the whole batch).")
    groups = {}
    for a in issue["addresses"]:
        groups.setdefault(a["outcome"], []).append(a)
    lines = [f"Automatic singles check (run {run_id}):"]
    for k in ("accepted", "already", "no_derelict", "held", "nonexistent", "invalid", "error", "duplicate"):
        sub = {}
        for a in groups.get(k, []):         # one line per outcome and file / reason (short comments for big batches)
            if k == "nonexistent":          # one line, each address with its own reason
                why = str(a.get("detail") or "")[len(NONEXISTENT) + 2:-1]
                sub.setdefault(None, []).append(f"`{a['address']}` ({why})")
                continue
            sub.setdefault(a.get("file") if k == "accepted" else a.get("detail"), []).append(f"`{a['address']}`")
        for extra, items in sorted(sub.items(), key=lambda kv: str(kv[0])):
            more = f" (+{len(items) - COMMENT_LIST} more)" if len(items) > COMMENT_LIST else ""
            lines.append(f"- {NAMES[k]}{f' ({extra})' if extra else ''}: {len(items)}: "
                         + ", ".join(items[:COMMENT_LIST]) + more)
    found_none = sum(1 for a in groups.get("accepted", []) if a.get("reported") == "none")
    if found_none:
        lines.append(f"- reported as 'none' but the recompute found a derelict: {found_none} (published)")
    if issue["invalid_matches"] or issue["over_cap"]:
        lines.append(f"- ignored: {issue['invalid_matches']} lines that are not one valid address, "
                     f"{issue['over_cap']} addresses over the {MAX_PER_ISSUE}-per-issue limit")
    verified = [a for a in issue["addresses"] if a.get("verified")]
    if verified:
        lines.append(f"- verified by a rescan with the site's scanner: {len(verified)}: "
                     + ", ".join(f"`{a['address']}` ({a['verified']})" for a in verified[:COMMENT_LIST]))
    if not issue["addresses"]:
        lines.append("- no valid system address found")
    return "\n".join(lines)


def comment(args):
    s = json.loads(Path(args.summary).read_text(encoding="utf-8"))
    dry = Path(args.dry_run) if args.dry_run else None
    rn = None if dry else repo_name()
    done = 0
    for it in s["issues"]:
        n = int(it["number"])
        if it.get("close"):
            calls = [("POST", f"/issues/{n}/comments", {"body": comment_text(s["run_id"], it)}),
                     ("PATCH", f"/issues/{n}", {"state": "closed", "state_reason": "completed"})]
        elif it.get("add_label"):           # report: a PC row differs -> stays open for the scanner agent
            calls = [("POST", f"/issues/{n}/comments", {"body": comment_text(s["run_id"], it)}),
                     ("POST", f"/issues/{n}/labels", {"labels": [it["add_label"]]})]
        else:
            continue
        for method, path, body in calls:
            if dry:
                with open(dry, "a", encoding="utf-8", newline="\n") as f:
                    f.write(json.dumps({"method": method, "path": path, "body": body}, sort_keys=True) + "\n")
            else:
                gh_request(method, f"/repos/{rn}{path}", body)
        done += 1
    print(f"{done} issues commented (closed, or labelled {REPORT_PC_LABEL})")


def pages_build(args):
    try:
        r = gh_request("POST", f"/repos/{repo_name()}/pages/builds")
        print(f"Pages build requested: {(r or {}).get('status')}")
    except (urllib.error.URLError, RuntimeError, OSError) as exc:
        print(f"Pages build request failed (the push may have started a build anyway): {exc}")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(prog="singles.py")
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("check-w29")
    c.add_argument("--repo", default=".")
    c = sub.add_parser("fetch-issues")
    c.add_argument("--out", required=True)
    c = sub.add_parser("process")
    c.add_argument("--repo", default=".")
    c.add_argument("--issues-file", required=True)
    c.add_argument("--summary", required=True)
    c.add_argument("--cache")
    c.add_argument("--message")
    c.add_argument("--run-id", default="local")
    c.add_argument("--workers", type=int, default=0)
    c.add_argument("--utc")
    c.add_argument("--deadline", type=float, help="epoch seconds: no new scan starts after it (rest: next run)")
    c.add_argument("--split-bytes", type=int, default=SPLIT_BYTES)
    c.add_argument("--community-total", type=int)
    c.add_argument("--atlas-cap", type=int)
    c.add_argument("--none-verified", action="store_true", help="tests: force NONE_VERIFIED on")
    c = sub.add_parser("comment")
    c.add_argument("--summary", required=True)
    c.add_argument("--dry-run")
    sub.add_parser("pages-build")
    args = ap.parse_args(argv)
    try:
        if args.cmd == "check-w29":
            print(check_w29(Path(args.repo).resolve()))
            counts = RegionCounts()
            try:
                n = len(W29D_SELFTEST) + len(W29D_PURPLE_SELFTEST)
                print(f"w29d region count: pinned files ok, self-test {counts.start()}/{n} ok")
            finally:
                counts.close()
        elif args.cmd == "fetch-issues":
            fetch_issues(args.out)
        elif args.cmd == "process":
            process(args)
        elif args.cmd == "comment":
            comment(args)
        elif args.cmd == "pages-build":
            return pages_build(args)
    except W29Error as exc:
        print(f"W29 integrity check failed: {exc}", file=sys.stderr)
        return 3
    except W29dError as exc:
        print(f"W29d region count failed (the run stops; no fallback rule): {exc}", file=sys.stderr)
        return 4
    return 0


if __name__ == "__main__":
    sys.exit(main())
