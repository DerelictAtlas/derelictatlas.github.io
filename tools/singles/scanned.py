"""CULL1 (CULLING_SPEC v1.1, 2026-11-10): scanned-systems bitmaps ("culling counters").

A visitor's browser scans whole regions but uploads only about 1 in 10 rows (the "keep" rule, SITE side). It also
sends, per region, a bitset of EVERY system it scanned plus one character per set bit (the module count), so culled
systems still count toward the atlas total. The relay (1.4) files them as issues labelled `scanned-bits`; the singles
Action (singles.py) merges them into scanned/** and writes stats/scanned.json; rerank.py adds the `community` block to
stats/systems.json. This module is the one place for the format; build_atlas_index.py (PC) keeps a COPY of it.

Bit order: system index i = bit (i & 7) of byte (i >> 3); bit 0 is never set, bits above 0x428 never.
Characters: DIGITS[m] (m = Salvaged Frigate Modules 0..35), '-' scanned / no derelict (scan status 4), '?' unknown.
A set bit is "counted elsewhere" (never counted twice) when its region file covers it or a singles row exists
(counted_elsewhere). community.total = stats total_systems + singles rows not in the main index + scanned_no_row.
Python 3 standard library only (3.9+).
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import json
import re
import zlib
from pathlib import Path

FORMAT = 1
LABEL = "scanned-bits"
BATCH = "scanned batch v1"
MAX_ISSUES = 50                 # scanned-bits issues per run (own cap, not in singles.MAX_ISSUES)
MAX_RAW = 4_000_000             # bytes of one issue payload after gunzip
SAMPLE_PERCENT = 1              # rescanned share of an issue's new bits (0 new bits = no sample)
SPLIT_BYTES = 262_144           # a bucket over this splits one level down (gGG -> gGG/YY -> gGG/YY/Z)
DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz"   # = app/pruning.py / atlas_rules.DIGITS
CHARS = DIGITS + "-?"
MAX_IDX = 0x428                 # last purple index (atlas_rules.PURPLE[1])
PURPLE = (0x3E8, 0x428)
MAX_BYTES = MAX_IDX // 8 + 1    # 134
MAX_REGIONS, MAX_BITS, MAX_PART = 32, 8192, 65536   # per request (relay 1.4)
REGION8 = re.compile(r"[0-9A-F]{8}")
SCANNER = re.compile(r"[0-9A-Za-z ;:.+_()/=-]{1,200}")   # = relay V3 scanner rule
FP16 = re.compile(r"[0-9a-f]{16}")
ROOT = Path("scanned")
MANIFEST = ROOT / "manifest.json"
STATS = Path("stats") / "scanned.json"
COLUMNS = "region,bits,modules"
REGION_COLUMNS = ["galaxy", "region", "systems", "no_row", "none", "unknown", "histogram"]
ABOUT = ("Scanned-systems summary of scanned/ (written by the singles Action). no_row = scanned systems with no "
         "published row (culled by the browser): they count toward the atlas total once each. histogram[m] = no_row "
         "systems with m Salvaged Frigate Modules; none = no derelict; unknown = module count unknown. "
         "community.total = the number the 1,000,000 bar shows.")


class Bad(ValueError):
    pass


# ---------------------------------------------------------------- encoding
def encode_bits(indices):
    """Canonical base64 of the bitset (trailing zero bytes cut)."""
    top = max(indices)
    buf = bytearray(top // 8 + 1)
    for i in indices:
        buf[i >> 3] |= 1 << (i & 7)
    return base64.b64encode(bytes(buf)).decode("ascii")


def decode_bits(b64):
    """(raw bytes, ascending set indices); ValueError when not strict base64."""
    raw = base64.b64decode(b64, validate=True)
    return raw, [k * 8 + j for k, byte in enumerate(raw) for j in range(8) if byte >> j & 1]


def encode_region(chars):
    """{index: char} -> (b64, m)."""
    idx = sorted(chars)
    return encode_bits(idx), "".join(chars[i] for i in idx)


def char_of(status, frigate_modules):
    """The rescan character: status 0 + int 0..35 -> DIGITS[m]; status 0 otherwise -> '?'; status 4 -> '-';
    anything else None (a scan error)."""
    if status == 4:
        return "-"
    if status != 0:
        return None
    s = "" if frigate_modules is None else str(frigate_modules).strip()
    return DIGITS[int(s)] if s.isdigit() and int(s) <= 35 else "?"


# ---------------------------------------------------------------- the checks (relay 1.4 has a copy: test_cull1)
def check_entry(e, n="?"):
    """One {g, r, b, m} entry -> its ascending indices; Bad(reason) otherwise. Reasons hold names only."""
    if not isinstance(e, dict) or set(e) != {"g", "r", "b", "m"}:
        raise Bad(f"scanned[{n}]: keys must be g, r, b, m")
    return _check_gbm(e, n)


def _check_gbm(e, n):
    g, r, b, m = e["g"], e["r"], e["b"], e["m"]
    if type(g) is not int or not 0 <= g <= 255:
        raise Bad(f"scanned[{n}]: g must be 0..255")
    if not isinstance(r, str) or not REGION8.fullmatch(r):
        raise Bad(f"scanned[{n}]: r must be REGION8 (8 upper-case hex)")
    if not isinstance(b, str) or not 4 <= len(b) <= 180:
        raise Bad(f"scanned[{n}]: b length")
    try:
        raw, idx = decode_bits(b)
    except (ValueError, binascii.Error):
        raise Bad(f"scanned[{n}]: b is not base64") from None
    if not raw or raw[-1] == 0 or len(raw) > MAX_BYTES or base64.b64encode(raw).decode("ascii") != b:
        raise Bad(f"scanned[{n}]: b is not canonical (1..{MAX_BYTES} bytes, last byte not 0)")
    if idx[0] == 0 or idx[-1] > MAX_IDX:
        raise Bad(f"scanned[{n}]: index 0 or an index above 428")
    if not isinstance(m, str) or len(m) != len(idx) or any(c not in CHARS for c in m):
        raise Bad(f"scanned[{n}]: m must hold one of 0-9 a-z - ? per set bit")
    return idx


def check_part(part):
    """The request's `scanned` list -> (regions, set bits); Bad otherwise (relay 1.4 section 1.1)."""
    if not isinstance(part, list) or not 1 <= len(part) <= MAX_REGIONS:
        raise Bad(f"scanned must be a list of 1..{MAX_REGIONS} regions")
    if len(json.dumps(part, separators=(",", ":")).encode("utf-8")) > MAX_PART:
        raise Bad(f"scanned is over {MAX_PART} bytes")
    seen, bits = set(), 0
    for n, e in enumerate(part):
        idx = check_entry(e, n)
        if (e["g"], e["r"]) in seen:
            raise Bad(f"scanned[{n}]: region twice")
        seen.add((e["g"], e["r"]))
        bits += len(idx)
    if bits > MAX_BITS:
        raise Bad(f"scanned: more than {MAX_BITS} systems")
    return len(part), bits


def check_record(rec, n="?"):
    """One issue record {g, r, b, m, scanner, fp} (relay queue line) -> its indices; Bad otherwise."""
    if not isinstance(rec, dict) or set(rec) != {"g", "r", "b", "m", "scanner", "fp"}:
        raise Bad(f"record {n}: keys must be g, r, b, m, scanner, fp")
    if not isinstance(rec["scanner"], str) or not SCANNER.fullmatch(rec["scanner"]):
        raise Bad(f"record {n}: bad scanner")
    if not isinstance(rec["fp"], str) or not FP16.fullmatch(rec["fp"]):
        raise Bad(f"record {n}: bad fp")
    try:
        return _check_gbm(rec, n)
    except Bad as exc:
        raise Bad(str(exc).replace(f"scanned[{n}]", f"record {n}")) from None


def _no_dup(pairs):
    d = {}
    for k, v in pairs:
        if k in d:
            raise ValueError("a duplicate key")
        d[k] = v
    return d


def _no_const(_name):
    raise ValueError("NaN / Infinity")


def parse_body(lines):
    """Lines after the BATCH line -> ([(record, indices)] in order, error or None). Exactly one fenced base64 block
    of ONE gzip stream (<= MAX_RAW bytes) of ASCII JSON lines, each ending with '\\n'; any bad line rejects the whole
    issue (error = the reason, names only). The same (g, r) may appear in several records."""
    rest = [l for l in lines if l.strip()]
    if len(rest) < 3 or rest[0] != "```" or rest[-1] != "```":
        return [], "the body is not one fenced block"
    b64 = "".join(rest[1:-1])
    if not re.fullmatch(r"[A-Za-z0-9+/]+={0,2}", b64):
        return [], "the fenced block is not base64"
    try:
        data = base64.b64decode(b64, validate=True)
        d = zlib.decompressobj(wbits=31)
        raw = d.decompress(data, MAX_RAW)
        if d.unconsumed_tail or not d.eof or d.unused_data:
            return [], f"the payload is not one gzip stream of at most {MAX_RAW} bytes"
        text = raw.decode("ascii")
    except (ValueError, zlib.error, UnicodeDecodeError, binascii.Error):
        return [], "the payload is not base64(gzip(ASCII JSON lines))"
    if not text.endswith("\n"):
        return [], "the payload does not end with a line end"
    out = []
    for n, line in enumerate(text[:-1].split("\n"), 1):
        try:
            rec = json.loads(line, object_pairs_hook=_no_dup, parse_constant=_no_const)
        except json.JSONDecodeError:
            return [], f"record {n}: not JSON"
        except RecursionError:
            return [], f"record {n}: nested too deeply"
        except ValueError as exc:
            return [], f"record {n}: {exc}"
        try:
            idx = check_record(rec, n)
        except Bad as exc:
            return [], str(exc)
        out.append((rec, idx))
    if not out:
        return [], "the payload has no records"
    return out, None


def issue_body(records):
    """The relay's issue body for queue records (sort_keys, compact, gzip mtime 0, base64 76 per line)."""
    import gzip
    payload = "".join(json.dumps(r, sort_keys=True, separators=(",", ":")) + "\n" for r in records)
    b64 = base64.b64encode(gzip.compress(payload.encode("ascii"), mtime=0)).decode("ascii")
    return BATCH + "\n```\n" + "\n".join(b64[i:i + 76] for i in range(0, len(b64), 76)) + "\n```\n"


# ---------------------------------------------------------------- store (scanned/**)
def address(g, r, idx):
    return "000%03X%02X%s" % (idx, g, r)


def bucket_of(g, r, split):
    gg = "g%02X" % g
    if gg not in split:
        return f"scanned/{gg}.csv"
    if f"{gg}/{r[:2]}" not in split:
        return f"scanned/{gg}/{r[:2]}.csv"
    return f"scanned/{gg}/{r[:2]}/{r[2]}.csv"


def bucket_title(path):
    parts = path[len("scanned/"):-4].split("/")
    t = f"# nms-derelict-atlas scanned format {FORMAT}: galaxy {int(parts[0][1:], 16)}"
    if len(parts) > 1:
        t += f" layer {parts[1]}"
    if len(parts) > 2:
        t += f" group {parts[2]}"
    return t


PATH_RE = re.compile(r"scanned/g([0-9A-F]{2})(?:/([0-9A-F]{2})(?:/([0-9A-F]))?)?\.csv")


class Store:
    """scanned/**.csv -> {(g, REGION8): {index: char}}; the split state; the files on disk; bad lines skipped."""

    def __init__(self, repo):
        self.repo, self.regions, self.split, self.files, self.bad = Path(repo), {}, set(), set(), 0
        man = self.repo / MANIFEST
        if man.exists():
            try:
                self.split = set(json.loads(man.read_text(encoding="utf-8")).get("split") or [])
            except (ValueError, AttributeError):
                pass
        base = self.repo / ROOT
        for p in sorted(base.rglob("*.csv")) if base.exists() else []:
            rel = p.relative_to(self.repo).as_posix()
            m = PATH_RE.fullmatch(rel)
            if not m:
                continue
            self.files.add(rel)
            if m.group(2):
                self.split.add(f"g{m.group(1)}")
            if m.group(3):
                self.split.add(f"g{m.group(1)}/{m.group(2)}")
            g = int(m.group(1), 16)
            for line in p.read_text(encoding="utf-8").splitlines():
                if not line or line.startswith("#") or line == COLUMNS:
                    continue
                c = line.split(",")
                try:
                    if len(c) != 3:
                        raise Bad("columns")
                    idx = _check_gbm({"g": g, "r": c[0], "b": c[1], "m": c[2]}, 0)
                except Bad:
                    self.bad += 1
                    continue
                reg = self.regions.setdefault((g, c[0]), {})
                for i, ch in zip(idx, c[2]):
                    reg.setdefault(i, ch)

    def systems(self):
        return sum(len(v) for v in self.regions.values())

    def has(self, g, r, idx):
        return idx in self.regions.get((g, r), ())


def merge(regions, rec, idx, keep=lambda g, r, i: True):
    """OR + first claim wins, in place. keep(g, r, i) = the per-bit range check (False -> dropped).
    Returns {new, already, dropped, disagree}."""
    g, r = rec["g"], rec["r"]
    c = {"new": 0, "already": 0, "dropped": 0, "disagree": 0}
    reg = None
    for i, ch in zip(idx, rec["m"]):
        if not keep(g, r, i):
            c["dropped"] += 1
            continue
        if reg is None:
            reg = regions.setdefault((g, r), {})
        if i in reg:
            c["already"] += 1
            c["disagree"] += reg[i] != ch
        else:
            reg[i] = ch
            c["new"] += 1
    return c


def texts(regions, split, split_bytes=SPLIT_BYTES):
    """{path: bucket text}; split (a set) grows in place when a bucket passes split_bytes (never merged back)."""
    while True:
        buckets = {}
        for (g, r), reg in regions.items():
            if reg:
                buckets.setdefault(bucket_of(g, r, split), []).append((r, reg))
        out = {}
        for path, regs in buckets.items():
            lines = [bucket_title(path), COLUMNS]
            for r, reg in sorted(regs, key=lambda x: x[0]):
                b, m = encode_region(reg)
                lines.append(f"{r},{b},{m}")
            out[path] = "\n".join(lines) + "\n"
        grow = [p[len("scanned/"):-4] for p, t in out.items()
                if len(t.encode("utf-8")) > split_bytes and p.count("/") < 3]
        if not grow:
            return out
        split.update(grow)


def manifest(regions, split, files):
    return {"format": FORMAT, "regions": sum(1 for v in regions.values() if v),
            "systems": sum(len(v) for v in regions.values()), "split": sorted(split),
            "files": [{"path": p, "regions": files[p].count("\n") - 2, "bytes": len(files[p].encode("utf-8")),
                       "sha256": hashlib.sha256(files[p].encode("utf-8")).hexdigest()} for p in sorted(files)]}


# ---------------------------------------------------------------- totals
def counted_elsewhere(info, g, r, idx, singles):
    """info = (count, top, purple, deferred) of the region file (atlas_rules.region_range) or None; singles = set
    of (galaxy, glyphs12) of the singles rows. True when the system already counts in total_systems or as a single."""
    if info is not None:
        _, top, purple, deferred = info
        if idx not in deferred and ((top is not None and 1 <= idx <= top) or
                                    (purple and PURPLE[0] <= idx <= PURPLE[1])):
            return True
    return (g, "0%03X%s" % (idx, r)) in singles


def no_row_keys(regions, info_of, singles):
    """{(galaxy, glyphs12)} of the set bits not counted elsewhere."""
    out = set()
    for (g, r), reg in regions.items():
        info = info_of(g, r)
        out.update((g, "0%03X%s" % (i, r)) for i in reg if not counted_elsewhere(info, g, r, i, singles))
    return out


def community(region_systems, singles_n, scanned_no_row, atlas_cap=1_000_000):
    if region_systems is None:
        return None
    total = region_systems + singles_n + scanned_no_row
    return {"region_systems": region_systems, "singles": singles_n, "scanned_no_row": scanned_no_row,
            "total": total, "atlas_cap": atlas_cap, "cap_reached": total >= atlas_cap}


def summary(regions, info_of, singles, region_systems, singles_n, now, atlas_cap=1_000_000):
    """The stats/scanned.json document. singles = keys for counted_elsewhere; singles_n = singles rows not in the
    main index (the community term). The histograms are DERIVED every run, never summed."""
    hist, rows, nr_all, none_all, unk_all = [], [], 0, 0, 0
    for (g, r), reg in sorted(regions.items()):
        if not reg:
            continue
        info = info_of(g, r)
        h, nr, nn, uk = [], 0, 0, 0
        for i, c in reg.items():
            if counted_elsewhere(info, g, r, i, singles):
                continue
            nr += 1
            if c == "-":
                nn += 1
            elif c == "?":
                uk += 1
            else:
                m = DIGITS.index(c)
                h.extend([0] * (m + 1 - len(h)))
                h[m] += 1
        hist.extend([0] * (len(h) - len(hist)))
        for m, v in enumerate(h):
            hist[m] += v
        rows.append([g, r, len(reg), nr, nn, uk, h])
        nr_all, none_all, unk_all = nr_all + nr, none_all + nn, unk_all + uk
    return {"format": FORMAT, "updated": now, "about": ABOUT,
            "systems": sum(len(v) for v in regions.values()), "no_row": nr_all, "histogram": hist,
            "none": none_all, "unknown": unk_all,
            "community": community(region_systems, singles_n, nr_all, atlas_cap),
            "region_columns": REGION_COLUMNS, "regions": rows}


def write(repo, regions, split, doc, changed, split_bytes=SPLIT_BYTES):
    """Write scanned/** + manifest + stats/scanned.json (doc), only what changed; remove buckets no longer used.
    Nothing is written while the store is empty and no scanned/ exists (fail soft: the site reads nothing)."""
    repo = Path(repo)
    files = texts(regions, split, split_bytes)

    def put(rel, text):
        p, data = repo / rel, text.encode("utf-8")
        if p.exists() and p.read_bytes() == data:
            return
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
        changed.append(rel)

    base = repo / ROOT
    old = sorted(p.relative_to(repo).as_posix() for p in base.rglob("*") if p.is_file()) if base.exists() else []
    for rel in old:
        if rel not in files and rel != MANIFEST.as_posix():
            (repo / rel).unlink()
            changed.append(rel)
    if not files:
        for rel in (MANIFEST.as_posix(), STATS.as_posix()):
            if (repo / rel).exists():
                (repo / rel).unlink()
                changed.append(rel)
    else:
        for rel, text in sorted(files.items()):
            put(rel, text)
        put(MANIFEST.as_posix(), json.dumps(manifest(regions, split, files), separators=(",", ":")) + "\n")
        put(STATS.as_posix(), json.dumps(doc, sort_keys=True, separators=(",", ":")) + "\n")
    if base.exists():
        for d in sorted((p for p in base.rglob("*") if p.is_dir()), key=lambda p: -len(p.parts)):
            if not any(d.iterdir()):
                d.rmdir()
        if not any(base.iterdir()):
            base.rmdir()
    return {p: files[p].count("\n") - 2 for p in sorted(files)}
