"""Singles publisher: visitor-scanned single systems -> singles/ + index/singles.csv + views/singles-extras.csv
(+ singles/none.csv: recomputed no-derelict systems, singles/held.csv: addresses outside every known system range
and, while NONE_VERIFIED is off, systems whose recompute gave scan status 4).

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
Exit codes: 0 ok, 1 error, 2 usage, 3 W29 integrity failure (scan/ files do not match scan/w29.json), 4 W29d region
count failure (tools/singles/w29d/ files do not match their pinned sha256, Node / the wasm does not start, the
self-test fails, or a count fails): the run stops, there is no fallback range.
"""
from __future__ import annotations
import argparse
import csv
import gzip
import hashlib
import io
import json
import os
import queue
import re
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.dont_write_bytecode = True                                 # no __pycache__ in the repo checkout
sys.path.insert(0, str(Path(__file__).resolve().parent))      # python -I does not add the script folder
import atlas_rules as R  # noqa: E402

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
HELD_FILE = SINGLES / "held.csv"            # held addresses + reason (HELD_REASONS), retried every run
HELD_MAX = 50_000                           # held.csv size cap (oldest first_seen dropped)
# Scan status 4 ("no abandoned freighter") of the browser engine is UNVERIFIED (RE job W31 checks it against the game;
# the PC publishes rows for some of these systems). While False, a status-4 recompute is neither written to none.csv
# nor rejected: the address is held with reason "status4" and retried once this is True. True = none.csv as designed.
NONE_VERIFIED = False
HELD_RANGE = "range"                        # held reason: outside every known system range (R.system_known)
HELD_STATUS4 = "status4"                    # held reason: recompute gave status 4 while NONE_VERIFIED is False
HELD_REASONS = (HELD_RANGE, HELD_STATUS4)
HELD_DETAIL = {HELD_RANGE: "not in a known system range yet (kept in singles/held.csv, retried every run)",
               HELD_STATUS4: "scan status 4 (no derelict) is not verified yet (kept in singles/held.csv, retried once "
                             "verified)"}
WORK_FILE = Path("stats") / "work.txt"      # region + system index work list (written by the PC; SITE format)
NONE_FORMAT = 1
HELD_FORMAT = 2                             # 2: + reason column (format 1 rows = reason range are still read)
OUTPUTS = (SINGLES.as_posix() + "/", INDEX_SINGLES.as_posix(), EXTRAS_SINGLES.as_posix())
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
        self.purple_computed = 0        # portal checks after the self-test (summary 'purple_checks')

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
    fmt = {BATCH_V1: "v1", BATCH_V2: "v2"}.get(lines[0] if lines else None, "other")
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


def usable_issues(issues):
    """Open single-scan issues (no pull requests), oldest first; at most MAX_ISSUES."""
    ok = []
    for it in issues if isinstance(issues, list) else []:
        if not isinstance(it, dict) or not isinstance(it.get("number"), int) or it.get("pull_request"):
            continue
        if it.get("state") != "open" or LABEL not in label_names(it):
            continue
        ok.append(it)
    ok.sort(key=lambda i: (str(i.get("created_at") or ""), i["number"]))
    return ok[:MAX_ISSUES]


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
    rn, got = repo_name(), []
    for page in range(1, MAX_ISSUES // 100 + 2):
        batch = gh_request("GET", f"/repos/{rn}/issues?state=open&labels={LABEL}&sort=created&direction=asc"
                                  f"&per_page=100&page={page}")
        if not isinstance(batch, list):
            break
        for it in batch:
            got.append({"number": it.get("number"), "state": it.get("state"),
                        "labels": sorted(n for n in label_names(it) if isinstance(n, str)),
                        "created_at": it.get("created_at"), "pull_request": bool(it.get("pull_request")),
                        "title": (it.get("title") or "")[:MAX_TEXT], "body": (it.get("body") or "")[:MAX_TEXT]})
        if len(batch) < 100 or len(got) >= MAX_ISSUES:
            break
    Path(out_path).write_text(json.dumps(got, ensure_ascii=True) + "\n", encoding="utf-8")
    print(f"{len(got)} open {LABEL} issues")


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
            "every run; reason range = outside every known system range (index not below the region's system count, "
            "no region file range, not in stats/work.txt), "
            "published once valid; reason status4 = the recompute found no derelict (scan status 4), which is not "
            "verified yet, retried once it is; first_seen = UTC time of the first batch issue that had it; at most "
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


def _process(args, repo, version, region_counts):
    global NONE_VERIFIED
    if args.none_verified:                              # tests only: the flag forced on
        NONE_VERIFIED = True
    if args.atlas_cap is not None:                      # tests only: a lowered cap
        R.ATLAS_CAP = args.atlas_cap
    atlas, store = Atlas(repo, region_counts), Store(repo)
    issues = usable_issues(json.loads(Path(args.issues_file).read_text(encoding="utf-8")))
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

    def classify(a):
        """('already' | 'invalid' | 'held' | 'scan', detail)."""
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
        if not atlas.known(a):
            return "held", HELD_DETAIL[HELD_RANGE]
        return "scan", ("deferred" if info and idx in info["deferred"] else None)

    # ---- take issues up to the run caps (MAX_PER_RUN = addresses to scan), classify every address ----
    taken, wait, first_issue, cls, to_scan, origin, n_scan, claim_none = [], [], {}, {}, [], {}, 0, set()
    for it in issues:
        p = parse_issue(it.get("title"), it.get("body"))
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
            if cls[a][0] in ("already", "invalid"):
                held.pop(a, None)
            if cls[a][0] == "scan":
                to_scan.append(a)
                origin[a] = it["number"]
        taken.append({"it": it, "addrs": addrs, "none": p["none"], "bad": p["bad"], "over": over,
                      "scanners": p["scanners"], "format": p["format"]})
    run_utc = iso(args.utc) or max((iso(t["it"].get("created_at")) or NO_TIME for t in taken), default=NO_TIME)
    # ---- held addresses: retried every run (after the issues, inside the run cap) ----
    held_dropped = []
    for a in sorted(held, key=lambda x: (held[x][0], x)):
        if a in first_issue:
            continue
        c = classify(a)
        if c[0] in ("already", "invalid"):
            held_dropped.append(a)
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
                reason = HELD_STATUS4 if cls[a][1] == HELD_DETAIL[HELD_STATUS4] else HELD_RANGE
                held[a] = (min((held.get(a) or ("9999",))[0], issue_time[t["it"]["number"]]), reason)
    # ---- scan ----
    deadline = args.deadline
    results = scan_all(repo / SCAN_DIR, to_scan, version, args.workers, args.cache, deadline=deadline) \
        if to_scan else {}
    total = args.community_total if args.community_total is not None else atlas.total()
    community = None if total is None else total + sum(1 for k in store.rows if k not in index_keys)
    running, cap_seen, tops = community, False, None
    fp = R.FINGERPRINTS[SINGLES_BUILD]
    extras_store = read_singles_extras(repo)
    for a in superseded:
        extras_store.pop(a, None)
    accepted, new_none, outcome, pending, reported_none_found = [], [], {}, [], 0
    for a in to_scan:
        res, o = results.get(a), outcome.setdefault(a, {})
        if cls[a][1] == "deferred":
            o["deferred"] = True
        if res is None:                                 # run time was up: next run (issue stays open / stays held)
            o.update(outcome="pending")
            pending.append(a)
            continue
        prev = held.pop(a, None)
        claimed_none = a in claim_none
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
            cap_mode = R.post_cap(running)
            if cap_mode and tops is None:
                tops = published_tops(atlas, store, index_keys, extras_store)
            cap_seen |= cap_mode
            line, tier, lists, rec = single_row(res["atlas"], res.get("extras"), fp, cap_mode, tops)
            gal, glyphs = int(a[6:8], 16), res["atlas"][0].upper()
            store.rows[(gal, glyphs)] = line
            o.update(outcome="accepted", tier=tier, **({"lists": lists} if lists else {}))
            if claimed_none:
                o["reported"] = "none"
                reported_none_found += 1
            if tier not in R.SLIM_TIERS:
                ex = {k: ("" if v == "ERR" else v) for k, v in (res.get("extras") or {}).items()}
                if any(v != "" for v in ex.values()):
                    extras_store[a] = ex
                if tops is not None:
                    R.add_to_tops(rec, tops)
            if running is not None:
                running += 1
            accepted.append(a)
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
        outcome[a]["file"] = bucket_of(int(a[6:8], 16), f"0{a[3:6]}{a[8:]}", store.split)
    n_index = write_index(repo, atlas, store, index_keys, changed)
    write_extras(repo, atlas, store, index_keys, extras_store, changed)
    write_small(repo, NONE_FILE, none_text(nones), not nones, changed)
    write_small(repo, HELD_FILE, held_text(held), not held, changed)
    # ---- summary ----
    counts = {k: 0 for k in ("accepted", "already", "no_derelict", "invalid", "error", "over_cap", "duplicate",
                             "held", "pending")}
    out_issues, scanners = [], {}
    for t in taken:
        num, lst = t["it"]["number"], []
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
    msg = f"singles: {len(accepted)} systems, {len(new_none)} without a derelict (run {args.run_id})"
    summary = {"format": 2, "run_id": args.run_id, "w29_version": version, "run_utc": run_utc,
               "community_total": community, "cap_mode": cap_seen or R.post_cap(community), "atlas_cap": R.ATLAS_CAP,
               "counts": counts,
               "tiers": {k: sum(1 for a in accepted if outcome[a]["tier"] == k) for k in ("detail", "full", "slim", "pruned")},
               "reported_none_found": reported_none_found, "scanners": scanners,
               "singles_rows": len(store.rows), "store_resigned": store.resigned, "store_bad_rows": store.bad,
               "build": SINGLES_BUILD, "index_rows": n_index, "none_rows": len(nones), "held_rows": len(held),
               "none_verified": NONE_VERIFIED,
               "held_reasons": {r: sum(1 for v in held.values() if v[1] == r) for r in HELD_REASONS},
               "held_retried": sum(1 for a in to_scan if origin[a] == "held"), "held_dropped": held_dropped,
               "held_over_cap": held_over, "pending": pending, "files": paths,
               "work_list": {"regions": len(atlas.work()[0]), "ignored_lines": atlas.work()[1]},
               "region_counts": region_counts.computed,
               "purple_checks": region_counts.purple_computed,
               "superseded": superseded, "superseded_mismatch": mismatch, "waiting_issues": wait,
               "changed": sorted(set(changed)), "commit_message": msg, "issues": out_issues}
    Path(args.summary).write_text(json.dumps(summary, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    if args.message:
        Path(args.message).write_text(msg + "\n", encoding="utf-8")
    print(f"{msg}: {json.dumps(counts, sort_keys=True)}; {len(superseded)} superseded; {len(pending)} left for the "
          f"next run; scanners {json.dumps(scanners, sort_keys=True)}; {len(set(changed))} files changed")
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
         "held": "held", "error": "could not be scanned", "duplicate": "also in another issue"}
COMMENT_LIST = 100              # addresses listed per comment line (a 3,000-address batch stays far below 65,536 chars)


def comment_text(run_id, issue):
    groups = {}
    for a in issue["addresses"]:
        groups.setdefault(a["outcome"], []).append(a)
    lines = [f"Automatic singles check (run {run_id}):"]
    for k in ("accepted", "already", "no_derelict", "held", "invalid", "error", "duplicate"):
        sub = {}
        for a in groups.get(k, []):         # one line per outcome and file / reason (short comments for big batches)
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
    if not issue["addresses"]:
        lines.append("- no valid system address found")
    return "\n".join(lines)


def comment(args):
    s = json.loads(Path(args.summary).read_text(encoding="utf-8"))
    dry = Path(args.dry_run) if args.dry_run else None
    rn = None if dry else repo_name()
    done = 0
    for it in s["issues"]:
        if not it.get("close"):
            continue
        n = int(it["number"])
        calls = [("POST", f"/issues/{n}/comments", {"body": comment_text(s["run_id"], it)}),
                 ("PATCH", f"/issues/{n}", {"state": "closed", "state_reason": "completed"})]
        for method, path, body in calls:
            if dry:
                with open(dry, "a", encoding="utf-8", newline="\n") as f:
                    f.write(json.dumps({"method": method, "path": path, "body": body}, sort_keys=True) + "\n")
            else:
                gh_request(method, f"/repos/{rn}{path}", body)
        done += 1
    print(f"{done} issues commented and closed")


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
