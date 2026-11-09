"""RANK1 (2026-11-03, SITE: visitor singles were never ranked into the 15 map lists): re-rank the map lists after a
singles run, exactly as the PC publish (build_atlas_index.build) does on the same files:

  candidates = the main index rows (index/manifest.json + shards) + the rows of index/singles.csv without a main index
  row (the atlas row wins), each single with its items_value / items_nanites from views/singles-extras.csv;
  item values of the atlas rows = views/extras.csv.gz; incumbents / kept maps = views/top100.json.gz "k" +
  views/map-lists.txt (previous_maps).

Writes views/map-lists.txt (all systems in a list, same text as build()), the "maps" and "map_lists" parts of
stats/systems.json (everything else in it stays: tiers / totals count no singles) and the map column of
index/singles.csv. It never makes maps: a single that enters a list has map bits but no entry in views/top100.json.gz
until the next PC publish (the PC then adds its map; the site draws one on the device meanwhile). A system that drops
out of every list loses its map-lists.txt line (its bundle entry stays until the next PC publish).

The functions between the VENDORED markers are copied verbatim from build_atlas_index.py of the scanner
(D:/Orca/NMS-Derelict-Probe/tools, RANK1) and MAP_LISTS / TOP_N / KEEP_S_REWARD_MAPS equal the scanner's
pruning.py; tests: fastgen tests/test_rank1.py (source equality + same output files as build()).
Python 3 standard library only.
"""
from __future__ import annotations

import csv
import gzip
import io
import json
from pathlib import Path

# ---- constants of build_atlas_index.py / pruning.py (the scanner sets build_atlas_index's from pruning.py)
TOP_N = 100
HIGH_THEN = (("total", "highest"), ("crates", "highest"))
MAP_LISTS = {
    "total": {"bit": 1, "label": "Most crates + footlockers", "value": "total", "direction": "highest", "then": HIGH_THEN},
    "frigate_modules": {"bit": 2, "label": "Most frigate modules", "value": "frigate_modules", "direction": "highest", "then": HIGH_THEN},
    "crates": {"bit": 8, "label": "Most crates", "value": "crates", "direction": "highest", "then": HIGH_THEN},
    "footlockers": {"bit": 16, "label": "Most footlockers", "value": "footlockers", "direction": "highest", "then": HIGH_THEN},
    "briefcases": {"bit": 32, "label": "Most briefcases", "value": "briefcases", "direction": "highest", "then": HIGH_THEN},
    "tall_lockers": {"bit": 64, "label": "Most tall lockers", "value": "tall_lockers", "direction": "highest", "then": HIGH_THEN},
    "rooms": {"bit": 128, "label": "Most rooms", "value": "rooms", "direction": "highest", "then": HIGH_THEN},
    "floors": {"bit": 256, "label": "Most floors", "value": "floors", "direction": "highest", "then": HIGH_THEN},
    "stairs": {"bit": 512, "label": "Most stairs", "value": "stairs", "direction": "highest", "then": HIGH_THEN},
    "hangar": {"bit": 1024, "label": "Hangar", "value": "hangar", "direction": "highest", "then": HIGH_THEN},
    "reward": {"bit": 2048, "label": "Best end reward", "value": "reward", "direction": "highest", "then": HIGH_THEN},
    "frigate_modules_lowest": {"bit": 4096, "label": "Fewest frigate modules", "value": "frigate_modules", "direction": "lowest",
                               "then": (("crates", "lowest"), ("total", "lowest"))},
    "crates_lowest": {"bit": 8192, "label": "Fewest crates", "value": "crates", "direction": "lowest",
                      "then": (("frigate_modules", "lowest"), ("total", "lowest"))},
    "items_value": {"bit": 32768, "label": "Most value (systems with loot values)", "value": "items_value", "direction": "highest", "then": HIGH_THEN},
    "items_nanites": {"bit": 65536, "label": "Most nanites (systems with loot values)", "value": "items_nanites", "direction": "highest", "then": HIGH_THEN},
    # LISTS2 (2026-11-08, user via SITE; additive: appended after every older list, bit 262144; bit 131072 stays
    # unused: its "Most hangars" list was dropped 2026-11-09 for Most ships): Most containers = crates + footlockers
    # + briefcases + tall lockers, only rows with all four counts (rows without briefcase / tall-locker counts are
    # unknown, not 0)
    "containers": {"bit": 262144, "label": "Most containers", "value": "containers", "direction": "highest",
                   "then": (("crates", "highest"), ("total", "highest"))},
    # SHIPS (2026-11-09, user via SITE; additive: appended after containers, bit 524288; replaces the dropped
    # "Most hangars" pieces list): Most ships = salvage ships (ROOM_WALLEXTERIOR_4_1 hangar pieces, one ship each),
    # from the ships column or views/ships.csv.gz; blank / missing = not counted (never 0); 0 never enters; then
    # total, then crates
    "ships": {"bit": 524288, "label": "Most ships", "value": "ships", "direction": "highest", "then": HIGH_THEN},
}
KEEP_S_REWARD_MAPS = False
MAP_KEPT_S = 4
MAP_OLD = 16384
BUNDLE_PATH = Path("views") / "top100.json.gz"
MAP_FILE = Path("views") / "map-lists.txt"
STATS = Path("stats") / "systems.json"
REWARD_RANK = {"C": 1, "B": 2, "A": 3, "S": 4}
EXTRAS_FILE = Path("views") / "extras.csv.gz"
EXTRAS_COLUMNS = ["address", "spookbox", "spookbox_ambiguous", "spookbox_alt", "items_value", "items_value_min",
                  "items_value_max", "items_nanites", "items_nanites_direct", "items_nanites_refiner", "items_nanites_min",
                  "items_nanites_max", "items_ambiguous", "items_tech", "items_top", "end_reward_value", "spookbox_value",
                  "items_units", "items_units_min", "items_units_max",
                  "items_all"]
ITEM_KEYS = ("items_value", "items_nanites")
ITEM_VALUES = {}
SHIPS_FILE = Path("views") / "ships.csv.gz"
SHIPS = {}
SINGLES_INDEX = Path("index") / "singles.csv"
SINGLES_EXTRAS = Path("views") / "singles-extras.csv"
SINGLE_MARK = "_single"
LAST = {}
_KINDS = {}
MANIFEST = Path("index") / "manifest.json"
OLD_INDEX = Path("index") / "systems.csv.gz"


# ---- VENDORED from build_atlas_index.py (verbatim; tests/test_rank1.py compares the source) ----
def address(r):
    """glyphs P SSS YY ZZZ XXX + galaxy -> universe address 000 SSS GG YY ZZZ XXX."""
    g = r["glyphs"]
    return f"000{g[1:4]}{r['galaxy']:02X}{g[4:]}"

def read_extras(atlas):
    """W26: {ADDRESS16: {column: cell string}} of EXTRAS_FILE ({} when the atlas has none)."""
    p = Path(atlas) / EXTRAS_FILE
    if not p.exists():
        return {}
    lines = [l for l in gzip.decompress(p.read_bytes()).decode("utf-8").splitlines() if l and not l.startswith("#")]
    return {r["address"].upper(): {c: r.get(c) or "" for c in EXTRAS_COLUMNS[1:]} for r in csv.DictReader(lines)}

def read_ships_file(path):
    """SHIPS2: ({ADDRESS16: ships}, ships data SHA-256 of its header or None) of a ships file; ({}, None) when missing."""
    p = Path(path)
    if not p.exists():
        return {}, None
    text = gzip.decompress(p.read_bytes()).decode("utf-8")
    head = text.split("\n", 1)[0]
    i = head.find("ships data sha256 ")
    sha = head[i + 18:i + 82] if head.startswith("#") and i >= 0 else None
    lines = [l for l in text.splitlines() if l and not l.startswith("#")]
    return {r["address"].upper(): int(r["ships"]) for r in csv.DictReader(lines) if (r.get("ships") or "").isdigit()}, sha


def read_ships(atlas):
    """SHIPS2: {ADDRESS16: ships} of SHIPS_FILE ({} when the atlas has none)."""
    return read_ships_file(Path(atlas) / SHIPS_FILE)[0]

def item_values_of(extras):
    """W26: ITEM_VALUES entries from read_extras() output (systems with an items value)."""
    return {a: {k: (int(v[k]) if v.get(k) not in (None, "") else None) for k in ITEM_KEYS}
            for a, v in extras.items() if any(v.get(k) not in (None, "") for k in ITEM_KEYS)}

def is_s_reward(r):
    """S-class end reward: reward_class 'S', or an ambiguous prediction (reward_ambiguous 1) whose alternative
    (reward_alt, "NAME CLASS") is S-class. Kept generously: a map is never dropped for a possible S."""
    if (r.get("reward_class") or "").upper() == "S":
        return True
    return (r.get("reward_ambiguous") or "") in ("1", "true") and (r.get("reward_alt") or "").rstrip().upper().endswith(" S")

def list_value(key, r):
    """A row's value for a map list (None = not known): the viewer's sort value of that column."""
    def num(k):
        v = r.get(k)
        return None if v is None or v == "" else int(v)
    if key == "total":
        c, f = num("crates"), num("footlockers")
        return None if c is None or f is None else c + f
    if key == "hangar":
        h = num("hangars")
        return None if h is None else int(h > 0)
    if key == "containers":     # LISTS2: unknown when any of the four counts is unknown
        parts = [num(k) for k in ("crates", "footlockers", "briefcases", "tall_lockers")]
        return None if None in parts else sum(parts)
    if key == "reward":
        return REWARD_RANK.get(str(r.get("reward_class") or "").upper())
    if key in ITEM_KEYS and r.get(key) in (None, "") and "glyphs" in r and "galaxy" in r:   # W26: index rows: ITEM_VALUES
        v = ITEM_VALUES.get(address(r), {}).get(key)
        return None if v is None or v == "" else int(v)
    if key == "ships" and r.get("ships") in (None, "") and "glyphs" in r and "galaxy" in r:   # SHIPS2: index rows: SHIPS
        v = SHIPS.get(address(r))
        return None if v is None else int(v)
    return num(key)

def list_key(spec, r):
    """Sort key of a row in a list without the identity part (smaller = better); unknown tie-break values last."""
    out = []
    for k, d in ((spec["value"], spec["direction"]),) + tuple(spec.get("then") or ()):
        v = list_value(k, r)
        out += [1, 0] if v is None else [0, -v if d == "highest" else v]
    return tuple(out)

def qualifies(spec, r):
    v = list_value(spec["value"], r)
    return v is not None and (v > 0 if spec["direction"] == "highest" else True)

def list_size(spec):
    return int(spec.get("size") or TOP_N)

def previous_maps(atlas):
    """{ADDRESS16: list bits} of the systems that had a map: views/top100.json.gz ("k") and MAP_FILE, so either file
    alone keeps the S-reward maps and the list incumbents. A file that exists but can't be read raises: the keep list
    must never be lost by accident. An atlas without MAP_FILE is from before the map lists: every map in its bundle
    gets MAP_OLD (kept forever); later builds carry the bit in both files."""
    out = {}
    m = Path(atlas) / MAP_FILE
    p = Path(atlas) / BUNDLE_PATH
    if p.exists():
        doc = json.loads(gzip.decompress(p.read_bytes()).decode("utf-8"))
        k = doc.get("k") or {}
        for a in doc["s"]:
            out[a] = int(k.get(a, 0)) | (0 if m.exists() else MAP_OLD)
    if m.exists():
        for line in m.read_text(encoding="utf-8").splitlines():
            if line.strip() and not line.startswith("#"):
                a, _, bits = line.partition(" ")
                out[a] = out.get(a, 0) | int(bits or 0)
    return out

def top_list(rows, spec, prev=None):
    """The list's rows, best first (heap: O(n log size))."""
    import heapq
    prev = LAST.get("prev", {}) if prev is None else prev
    bit = spec["bit"]
    return heapq.nsmallest(list_size(spec), (r for r in rows if qualifies(spec, r)),
                           key=lambda r: (list_key(spec, r), 0 if int(prev.get(address(r), 0)) & bit else 1,
                                          r["glyphs"], r["galaxy"]))

def _lists(rows, prev):
    sig = (id(rows), len(rows), json.dumps(MAP_LISTS, sort_keys=True), TOP_N, KEEP_S_REWARD_MAPS,
           hash(tuple(sorted((a, v.get("items_value"), v.get("items_nanites")) for a, v in ITEM_VALUES.items()))),
           hash(tuple(sorted(SHIPS.items()))),
           tuple(sorted((a, int(b)) for a, b in prev.items())))
    if _KINDS.get("sig") != sig:
        _KINDS.clear()
        _KINDS.update(sig=sig, lists={name: top_list(rows, spec, prev) for name, spec in MAP_LISTS.items()})
    return _KINDS["lists"]

def map_kinds(rows, prev=None):
    """{(galaxy, glyphs): bits} for every system that has a map: the bits of the MAP_LISTS it is in, plus MAP_KEPT_S
    (4) when it has an S-class end reward and a map now or before (prev), so it keeps the map after leaving every list.
    prev = previous_maps() (default LAST["prev"])."""
    prev = LAST.get("prev", {}) if prev is None else prev
    kinds = {}
    for name, lst in _lists(rows, prev).items():
        for r in lst:
            k = (r["galaxy"], r["glyphs"])
            kinds[k] = kinds.get(k, 0) | MAP_LISTS[name]["bit"]
    for r in rows:
        k, a = (r["galaxy"], r["glyphs"]), address(r)
        if int(prev.get(a, 0)) & MAP_OLD:                       # maps from before the lists: never removed
            kinds[k] = kinds.get(k, 0) | MAP_OLD
        if KEEP_S_REWARD_MAPS and (k in kinds or a in prev) and is_s_reward(r):    # one build is a fixed point
            kinds[k] = kinds.get(k, 0) | MAP_KEPT_S
    return kinds

def map_list_stats(rows, prev=None):
    """[{name, bit, label, value, direction, then, size, entries, cut_key}] for stats/systems.json: cut_key = the
    list_key of the last entry when the list is full (a new system must have a smaller key to enter; equal keys stay
    with the incumbent), None while the list has room (any qualifying value enters)."""
    prev = LAST.get("prev", {}) if prev is None else prev
    out = []
    for name, lst in _lists(rows, prev).items():
        spec = MAP_LISTS[name]
        full = len(lst) >= list_size(spec)
        out.append({"name": name, "bit": spec["bit"], "label": spec["label"], "value": spec["value"],
                    "direction": spec["direction"], "then": [list(x) for x in spec.get("then") or ()],
                    "size": list_size(spec), "entries": len(lst), "cut_key": list(list_key(spec, lst[-1])) if full else None})
    return out

def read_singles(atlas):
    """RANK1: the rows of SINGLES_INDEX as map-list candidates: dicts of its columns (strings), glyphs upper case,
    galaxy int, SINGLE_MARK True, plus items_value / items_nanites from SINGLES_EXTRAS when it has them; first row per
    (galaxy, glyphs). [] when the file is missing."""
    p = Path(atlas) / SINGLES_INDEX
    if not p.exists():
        return []
    items = {}
    x = Path(atlas) / SINGLES_EXTRAS
    if x.exists():
        lines = [l for l in x.read_text(encoding="utf-8").splitlines() if l and not l.startswith("#")]
        items = {r["address"].upper(): r for r in csv.DictReader(lines)}
    out, seen = [], set()
    for rec in csv.DictReader([l for l in p.read_text(encoding="utf-8").splitlines() if l and not l.startswith("#")]):
        rec["glyphs"], rec["galaxy"] = rec["glyphs"].upper(), int(rec["galaxy"])
        k = (rec["galaxy"], rec["glyphs"])
        if k in seen:
            continue
        seen.add(k)
        rec[SINGLE_MARK] = True
        for c in ITEM_KEYS:
            v = (items.get(address(rec)) or {}).get(c) or ""
            if v != "":
                rec[c] = v
        out.append(rec)
    return out

def list_rows(atlas, rows):
    """RANK1: the map-list candidates: rows (region rows) + read_singles(atlas) without a region row."""
    have = {(r["galaxy"], r["glyphs"]) for r in rows}
    return list(rows) + [s for s in read_singles(atlas) if (s["galaxy"], s["glyphs"]) not in have]

# ---- END VENDORED ----


def index_rows(repo):
    """The main index rows (as build_atlas_index.read_atlas gives them: index columns as strings, glyphs upper, galaxy
    int): manifest + shards (format 7), else the old index/systems.csv.gz; None when the repo has no main index."""
    repo = Path(repo)
    texts = []
    if (repo / MANIFEST).exists():
        doc = json.loads((repo / MANIFEST).read_text(encoding="utf-8"))
        texts = [(repo / s["path"]).read_text(encoding="utf-8") for s in doc["shards"]]
    elif (repo / OLD_INDEX).exists():
        texts = [gzip.decompress((repo / OLD_INDEX).read_bytes()).decode("utf-8")]
    else:
        return None
    rows = []
    for text in texts:
        for rec in csv.DictReader([l for l in text.splitlines() if l and not l.startswith("#")]):
            rec["glyphs"], rec["galaxy"] = rec["glyphs"].upper(), int(rec["galaxy"])
            rows.append(rec)
    return rows


def map_file_text(kinds):
    """views/map-lists.txt as build_atlas_index.build() writes it."""
    maps = sorted((address({"glyphs": g, "galaxy": gal}), v) for (gal, g), v in kinds.items())
    return ("# Systems with a full map (build_atlas_index.py): ADDRESS16 and the bits of its map lists (see "
            f"{STATS.as_posix()} map_lists; {MAP_KEPT_S} = kept for an S-class end reward; {MAP_OLD} = map from before "
            "the lists, kept forever)\n" + "".join(f"{a} {v}\n" for a, v in maps))


def singles_text(text, kinds):
    """index/singles.csv with its map column set to the singles' list bits (0 = in no list); '#' lines, the header
    and every other cell unchanged (the Action writes the file with csv.writer, LF)."""
    out = io.StringIO(newline="")
    w = csv.writer(out, lineterminator="\n")
    head = None
    for line in text.splitlines():
        if not line or line.startswith("#") or head is None:
            out.write(line + "\n")
            if line and not line.startswith("#"):
                head = next(csv.reader([line]))
                col, gi, ga = head.index("map"), head.index("glyphs"), head.index("galaxy")
            continue
        cells = next(csv.reader([line]))
        cells[col] = str(kinds.get((int(cells[ga]), cells[gi].upper()), 0))
        w.writerow(cells)
    return out.getvalue()


def rerank(repo):
    """{relative path: new text or None (unchanged)} of the re-rank, plus the singles' bits: (texts, bits).
    texts is {} when the repo has no main index or no stats/systems.json (nothing to rank against)."""
    repo = Path(repo)
    rows = index_rows(repo)
    if rows is None or not (repo / STATS).exists():
        return {}, {}
    ITEM_VALUES.clear()
    ITEM_VALUES.update(item_values_of(read_extras(repo)))
    SHIPS.clear()                   # SHIPS2: Most ships = the published views/ships.csv.gz (none: the list stays empty)
    SHIPS.update(read_ships(repo))
    _KINDS.clear()
    prev = previous_maps(repo)
    LAST.clear()
    LAST.update(atlas=repo, rows=None, prev=prev)
    lrows = list_rows(repo, rows)
    kinds = map_kinds(lrows, prev)
    stats = json.loads((repo / STATS).read_text(encoding="utf-8"))
    stats["maps"] = {"total": len(map_kinds(lrows)),
                     "kept_old": sum(1 for v in map_kinds(lrows).values() if v & MAP_OLD),
                     "kept_s_reward": sum(1 for v in map_kinds(lrows).values() if v & MAP_KEPT_S),
                     "per_list": {n: len(v) for n, v in _lists(lrows, LAST.get("prev", {})).items()}}
    stats["map_lists"] = map_list_stats(lrows)
    texts = {MAP_FILE.as_posix(): map_file_text(kinds),
             STATS.as_posix(): json.dumps(stats, sort_keys=True, separators=(",", ":")) + "\n"}
    if (repo / SINGLES_INDEX).exists():
        texts[SINGLES_INDEX.as_posix()] = singles_text((repo / SINGLES_INDEX).read_text(encoding="utf-8"), kinds)
    bits = {address(r): kinds.get((r["galaxy"], r["glyphs"]), 0) for r in lrows if r.get(SINGLE_MARK)}
    return texts, bits


def snapshot(repo):
    """Bytes of the re-ranked files before the singles run writes (None = missing): apply() uses it to report only
    real changes (singles.py's write_index first writes index/singles.csv with map 0)."""
    repo = Path(repo)
    return {p: (repo / p).read_bytes() if (repo / p).exists() else None
            for p in (MAP_FILE.as_posix(), STATS.as_posix(), SINGLES_INDEX.as_posix())}


def apply(repo, changed, before=None):
    """Re-rank and write (singles.py process, after index/singles.csv + views/singles-extras.csv are written).
    changed: the run's list of changed paths (updated: a path is in it iff its bytes differ from `before`, the
    snapshot() taken before the run wrote anything). Returns a summary dict."""
    repo = Path(repo)
    texts, bits = rerank(repo)
    for rel, text in texts.items():
        data = text.encode("utf-8")
        p = repo / rel
        if not p.exists() or p.read_bytes() != data:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(data)
        if before is not None and rel in before:
            differs = before[rel] != data
            while rel in changed and not differs:
                changed.remove(rel)
            if differs and rel not in changed:
                changed.append(rel)
    return {"ranked": bool(texts), "singles_in_lists": sum(1 for v in bits.values() if v),
            "lists": {n: sum(1 for a, v in bits.items() if v & s["bit"]) for n, s in MAP_LISTS.items()}}
