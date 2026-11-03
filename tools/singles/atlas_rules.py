"""Atlas rules copied from the scanner, so the singles Action applies EXACTLY the same rules (Python 3 stdlib only).

Keep in sync. Every item names its source (paths of the scanner's private trees; line numbers as of 2026-10-31):
  FG = D:/Orca/NMS-Derelict-Probe-fastgen/app   (atlas.py, pruning.py, store.py)
  TL = D:/Orca/NMS-Derelict-Probe/tools         (build_atlas_index.py, after IDX7)
If one of those sources changes (thresholds, map lists, row format, index columns), change it here too.

  item                                   source
  HEADER4                                FG atlas.py:79-81 (HEADERS[4])
  EXE_SHAS                               FG atlas.py:68 (+ the 7.10 hotfix build 7.10-b26295378, scanner agent
                                           2026-10-31; fastgen gets the same entry after its CONTRIB work)
  INPUT_DIGESTS, inputs_fingerprint,     FG atlas.py:90-100 (inputs_fingerprint: sha256 over
  FINGERPRINTS                             "nms-derelict-atlas/{fmt}/{EXE_SHAS[build]}" + the sha256 digests of the 3
                                           INPUT_FILES, FG atlas.py:84-86; the files are not public, their digests are
                                           copied here). Reproduces the published '# inputs' of 7.05 (b93f4648...) and
                                           7.10 (d629f648...) region files
  row_check                              FG atlas.py:103-107 (fp passed explicitly)
  is_row                                 FG atlas.py:251-253
  region_path                            FG atlas.py:303-304
  parse_runs                             FG atlas.py:425-430 (_parse_runs)
  parse_slim                             FG atlas.py:354-376 (lenient form, check verified)
  REGION_SYSTEMS, PURPLE, region_range   FG atlas.py:394-395 (region_csv writes '# region_systems'), 456-457 (reader)
  parse_work                             stats/work.txt, SITE -09 format (NMS-COORDINATION 2026-10-31 REQUEST
                                           "Contribute page"); writer: fastgen + build_atlas_index (CONTRIB, other agent)
  system_known                           singles Action only (CONTRIB 2026-10-31): which addresses are scanned / held;
                                           W29DW 2026-11-01: rule (c) = FG verify.py:92-94 (a system exists when
                                           1 <= index < region count, the count of RE_FULL W29d = FG rc_worker.py), was
                                           the interim ACCEPT_LOW_INDEX / LOW_INDEX_MAX (index <= 0DF); W29DW-2: or the
                                           purple window 3E8-428 in any region when the game's portal rule accepts it
                                           (W29d w29d_valid_system, purple unlocked; FG verify.py:94 takes 3E8-428
                                           anywhere)
  DETAIL_MIN_MODULES, ATLAS_CAP,
  POST_CAP_MIN_MODULES, TOP_N            FG pruning.py:22,23,29,30 (DEMO cap NOT copied: never used for real data)
  HIGH_THEN, MAP_LISTS, REWARD_RANK      FG pruning.py:39-62 (= TL build_atlas_index.py:86-107)
  list_value, list_key, qualifies,
  in_any_list                            FG pruning.py:65-109
  SLIM_TIERS, NONE, DIGITS, PRUNED_DIGITS FG pruning.py:111-114
  tier_for, post_cap, encode, decode     FG pruning.py:132-161
  keep_tier                              CONTRIB 2026-10-31 (user): replaces FG store.py:424-428 for singles: below
                                           the cap every found system keeps its full row; at/after the cap only a
                                           system that breaks into a map list (breaks_into), the rest pruned
  list_size, top_keys, breaks_into,
  add_to_tops                            the post-cap "breaks into a top-100 list" rule (user 2026-10-31, replaces
                                           POST_CAP_MIN_MODULES for singles): ranking = TL build_atlas_index.py:279-313
                                           (list_value, list_key, qualifies, list_size), 338-343 (top_list: heap of the
                                           list_size best; ties: incumbent first, then glyphs + galaxy), 396-406
                                           (map_list_stats: cut_key = list_key of the last entry of a full list);
                                           build_top_bundle.py uses the same lists. The fastgen agent adds the same rule
                                           to FG pruning.py (CONTRIB; not written yet when this was made): diff the two
                                           after its DONE
  ITEM_KEYS                              TL build_atlas_index.py:123 (lists ranked on views/extras values), 292-294
  INDEX_* / BUILD_LINE / DEFAULT_BUILD   TL build_atlas_index.py:48-59
  index_record                           TL build_atlas_index.py:157-168 (read_atlas: one region row -> record)
  index_cells                            TL build_atlas_index.py:494-496 (build(): record -> index cells)
  address                                TL build_atlas_index.py:412-415
  EXTRAS_COLUMNS, EXTRAS_FORMAT          TL build_atlas_index.py:124-128 (W28: format 2 = format 1 + items_units,
                                           items_units_min, items_units_max after spookbox_value; comment :118-123)
  extras_text                            TL build_atlas_index.py:433-445 (write_extras, plain text, own '#' wording)
  V3_* / v3_check_row / v3_check_extras  V3UP 2026-11-02: the line rules of a v3 results upload (headers = the
                                           published index shard header and TL EXTRAS_COLUMNS format 3; items_all
                                           rule = TL build_top_bundle.py:182-214 items_all_cells); the SAME block is
                                           in the Pi relay's relay.py
"""
from __future__ import annotations
import csv
import hashlib
import io
import json
import re
import unicodedata
from pathlib import Path

# ---- region-file format 4 (FG atlas.py) ----
HEADER4 = ("glyphs,preset,rooms,crates,footlockers,floors,stairs,hangars,briefcases,tall_lockers,"
           "reward_name,reward_class,reward_ambiguous,reward_alt,frigate_modules,frigate_modules_ambiguous,"
           "frigate_module_rooms,frigate_module_ids,frigate_module_alt_ids,room_detail,check")
COLUMNS4 = HEADER4.split(",")
EXE_SHAS = {"7.05": "13D5060D4EFB9D2A6A6B1B349BC4257231056CC2A055DF4BB15D816262CC3499",
            "7.10": "D1C7155764271EFF0733C37D1849E685A11DA3D54A41D685D7898FC0AAD83A87",
            "7.10-b26295378": "D393C6782D29E1915854C0D5CF42505C8093740C05DC53705DBED7E0D1D4AC37"}
# sha256 of FG atlas.INPUT_FILES (asset_source_rows.bin, generatedbasetemplatestable.mbin, freighterdungeonstable.mbin)
INPUT_DIGESTS = ("39c87c6855deb985b2d9e0febba0f66656b97ed46b5e73191cb77a94abd2328b",
                 "74d66f13761e6db71cd277772c346c9521eb7de520ae9492b0202a0b47429ebe",
                 "f5afb96f49560bf39a0ec6ffc295540ed4c38165e4458df2c7785fe391e1a82a")


def inputs_fingerprint(fmt, build):
    """FG atlas.inputs_fingerprint(fmt, build) from the copied input digests."""
    h = hashlib.sha256(f"nms-derelict-atlas/{fmt}/{EXE_SHAS[build]}".encode())
    for d in INPUT_DIGESTS:
        h.update(bytes.fromhex(d))
    return h.hexdigest()


FINGERPRINTS = {b: inputs_fingerprint(4, b) for b in EXE_SHAS}
SLIM = "# slim_modules"
DEFERRED_LIST = "# deferred_systems:"


def row_check(row_wo_check: str, fp: str) -> str:
    return hashlib.sha256(f"{fp}|{row_wo_check}".encode()).hexdigest()[:16]


def is_row(line: str) -> bool:
    return bool(line) and not line.startswith("#") and not line.startswith("glyphs,")


def region_path(galaxy: int, region: str) -> Path:
    return Path("regions") / f"g{galaxy:02X}" / region[:2] / region[2:5] / f"{region}.csv"


def parse_runs(text):
    out = set()
    for part in text.split():
        lo, _, hi = part.partition("-")
        out.update(range(int(lo, 16), int(hi or lo, 16) + 1))
    return out


def file_fingerprint(lines):
    for line in lines:
        if line.startswith("# inputs "):
            return line.split()[2]
        if not line.startswith("#"):
            break
    return None


REGION_SYSTEMS = re.compile(r"# region_systems (\d+) .*?scanned 001-([0-9A-F]{3})( \+ purple 3E8-428)?")
PURPLE = (0x3E8, 0x428)


def region_range(lines):
    """(count, top, purple, deferred) of a region file: '# region_systems <count> (portal-valid 001-...); scanned
    001-<top>[ + purple 3E8-428]; ...' and '# deferred_systems: <runs>' (None, None, False, set() when absent)."""
    count = top = None
    purple, deferred = False, set()
    for line in lines:
        if not line.startswith("#"):
            break
        if line.startswith("# region_systems "):
            m = REGION_SYSTEMS.match(line)
            if m:
                count, top, purple = int(m.group(1)), int(m.group(2), 16), bool(m.group(3))
        elif line.startswith(DEFERRED_LIST):
            deferred = parse_runs(line[len(DEFERRED_LIST):])
    return count, top, purple, deferred


WORK_LINE = re.compile(r"([0-9A-Fa-f]{2}) ([0-9A-Fa-f]{8})((?: [0-9A-Fa-f]{3}(?:-[0-9A-Fa-f]{3})?)*)")


def parse_work(text):
    """stats/work.txt -> ({(galaxy, REGION8): set(system index)}, ignored line count). '#' lines and empty lines
    are skipped; a line must be exactly 'GG REGION8 <items>' (items: 3-hex index or 'lo-hi' range, hex in any case,
    separated by single spaces; surrounding spaces ignored); anything else is ignored (counted). Index 0 and a range
    with hi < lo add nothing."""
    out, bad = {}, 0
    for line in (text or "").replace("\r", "").split("\n"):
        if not line.strip() or line.startswith("#"):
            continue
        m = WORK_LINE.fullmatch(line.strip())
        if not m:
            bad += 1
            continue
        s = out.setdefault((int(m.group(1), 16), m.group(2).upper()), set())
        s.update(i for i in parse_runs(m.group(3)) if 1 <= i <= 0xFFF)
    return out, bad


def system_known(idx, region, work, count, purple=None):
    """THE address rule of the singles Action: True when system index idx is a system of its region as the PC atlas
    sees it. region = None (no region file) or region_range(...) of the region file; work = the set of indexes
    stats/work.txt lists for that region (empty set when none); count = the region's system count (the game's own
    count: RE_FULL W29d, the same number as FG rc_worker.py and every published '# region_systems N'), an int, None
    (not known) or a function returning it (called only when (a) and (b) do not decide). Known = 1 <= idx <= FFF and
    (a) inside the region file's scanned range 001-<top> (or its purple 3E8-428 when the file has them) or in its
    '# deferred_systems', or (b) listed in stats/work.txt, or (c) idx < count (FG verify.py:92-94: a system exists when
    1 <= index < region count; region_csv writes 'portal-valid 001-<count-1>'), or (c') idx in the purple window
    PURPLE (3E8-428, the same in every region) and purple is true = the game's portal rule accepts the system with
    purple unlocked (W29d w29d_valid_system code 0: coordinates in range, not a core region, index != 0, then
    index < count or the purple window; RE -fa 2026-11-01, 496/496 vs the game; a visitor who scanned a purple system
    has purple unlocked). purple = None (not known), a bool, or a function returning it (called only for a window
    index that nothing else decides). (a) and (b) are always below the count (the PC derives them from it) except
    purple. A core region has count 0 and the portal rule rejects it: nothing in it is known. Everything else is held
    (W29DW 2026-11-01; was the interim rule index <= 0DF)."""
    if not 1 <= idx <= 0xFFF:
        return False
    if region is not None:
        _count, top, file_purple, deferred = region
        if top is not None and idx <= top:
            return True
        if file_purple and PURPLE[0] <= idx <= PURPLE[1]:
            return True
        if idx in deferred:
            return True
    if idx in work:
        return True
    if callable(count):
        count = count()
    if count is not None and idx < count:
        return True
    if PURPLE[0] <= idx <= PURPLE[1] and purple is not None:
        return bool(purple() if callable(purple) else purple)
    return False


def parse_slim(lines, fp):
    """{system index: character} of every '# slim_modules' line ('.' entries left out; a line whose check fails is
    skipped, as atlas.parse_slim(strict=False))."""
    out = {}
    for line in lines:
        if not line.startswith(SLIM + " "):
            continue
        try:
            rng, _, rest = line[len(SLIM) + 1:].partition(": ")
            chars, _, chk = rest.rpartition(" ")
            lo, _, hi = rng.partition("-")
            lo, hi = int(lo, 16), int(hi, 16)
            if len(chars) != hi - lo + 1 or row_check(f"slim_modules {rng}:{chars}", fp) != chk:
                continue
            for i, ch in enumerate(chars):
                if decode(ch) is not None:
                    out[lo + i] = ch
        except ValueError:
            continue
    return out


# ---- PR1 tiers (FG pruning.py) ----
DETAIL_MIN_MODULES = 5
ATLAS_CAP = 1_000_000
POST_CAP_MIN_MODULES = 7
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
    "items_value": {"bit": 32768, "label": "Most value", "value": "items_value", "direction": "highest", "then": HIGH_THEN},
    "items_nanites": {"bit": 65536, "label": "Most nanites", "value": "items_nanites", "direction": "highest", "then": HIGH_THEN},
}
REWARD_RANK = {"C": 1, "B": 2, "A": 3, "S": 4}


def list_value(key, r):
    def num(k):
        v = r.get(k)
        return None if v is None or v == "" else int(v)
    if key == "total":
        c, f = num("crates"), num("footlockers")
        return None if c is None or f is None else c + f
    if key == "hangar":
        h = num("hangars")
        return None if h is None else int(h > 0)
    if key == "reward":
        return REWARD_RANK.get(str(r.get("reward_class") or "").upper())
    return num(key)


def list_key(spec, r):
    out = []
    for k, d in ((spec["value"], spec["direction"]),) + tuple(spec.get("then") or ()):
        v = list_value(k, r)
        out += [1, 0] if v is None else [0, -v if d == "highest" else v]
    return tuple(out)


def qualifies(spec, r):
    v = list_value(spec["value"], r)
    return v is not None and (v > 0 if spec["direction"] == "highest" else True)


def in_any_list(r, cuts):
    if cuts is None:
        return []
    out = []
    for name, spec in MAP_LISTS.items():
        if name not in cuts or not qualifies(spec, r):
            continue
        c = cuts[name]
        if c is None or list_key(spec, r) < tuple(c):
            out.append(name)
    return out


SLIM_TIERS = ("slim", "pruned")
NONE = "."
DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz"
PRUNED_DIGITS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def tier_for(modules, post_cap_mode: bool) -> str:
    if modules is None:
        return "full"
    if post_cap_mode:
        return "detail" if modules >= POST_CAP_MIN_MODULES else "pruned"
    return "detail" if modules >= DETAIL_MIN_MODULES else "slim"


def post_cap(atlas_total) -> bool:
    return atlas_total is not None and atlas_total >= ATLAS_CAP


def encode(modules: int, pruned: bool) -> str:
    digits = PRUNED_DIGITS if pruned else DIGITS
    m = int(modules)
    if not 0 <= m < len(digits):
        raise ValueError(f"module count {m} cannot be packed (0..{len(digits) - 1})")
    return digits[m]


def decode(ch: str):
    if ch == NONE:
        return None
    if ch in DIGITS:
        return DIGITS.index(ch), False
    if ch in PRUNED_DIGITS:
        return PRUNED_DIGITS.index(ch), True
    raise ValueError(f"invalid slim_modules character {ch!r}")


ITEM_KEYS = ("items_value", "items_nanites")


def list_size(spec):
    return int(spec.get("size") or TOP_N)


def top_keys(rows):
    """{list name: the list_keys of the list's current entries, best first, at most list_size} over rows (dicts with
    the index columns, + items_value / items_nanites from the extras). Only the keys matter for breaks_into: the
    identity tie-breaks of build_atlas_index.top_list (incumbent, glyphs, galaxy) only order equal keys."""
    import heapq
    rows = list(rows)
    return {name: heapq.nsmallest(list_size(spec), (list_key(spec, r) for r in rows if qualifies(spec, r)))
            for name, spec in MAP_LISTS.items()}


def breaks_into(r, tops):
    """Names of the MAP_LISTS that system r breaks into (pure). tops = top_keys(...) of every published system
    (main index + index/singles.csv). r breaks into a list when it qualifies for it (highest lists: value > 0; lowest
    lists: any known value) and the list has fewer than list_size entries, or r's list_key is STRICTLY smaller (=
    better) than the key of the list's last entry: on a full tie the incumbent keeps its place. Same result as
    in_any_list(r, cuts) with cuts = {name: keys[-1] if the list is full else None}."""
    out = []
    for name, spec in MAP_LISTS.items():
        if not qualifies(spec, r):
            continue
        keys = tops.get(name) or []
        if len(keys) < list_size(spec) or list_key(spec, r) < keys[-1]:
            out.append(name)
    return out


def add_to_tops(r, tops):
    """Put system r (just published in full) into tops in place, so the next system of the run ranks against it."""
    import bisect
    for name, spec in MAP_LISTS.items():
        if qualifies(spec, r):
            keys = tops.setdefault(name, [])
            bisect.insort(keys, list_key(spec, r))
            del keys[list_size(spec):]


def keep_tier(r, post_cap_mode, tops):
    """(tier, lists) of a NEW visitor-scanned system (CONTRIB, user 2026-10-31: "keep all the data except for maps").
    Below the cap: 'detail' (full row, any module count; 'full' when the module count is unknown); no lists computed.
    At/after the cap: 'detail' only when r breaks into a map list (lists = their names), else 'pruned' (module count
    marker only); a system with an unknown module count cannot be pruned and stays 'full'."""
    if not post_cap_mode:
        return ("full" if r["frigate_modules"] is None else "detail"), []
    lists = breaks_into(r, tops or {})
    if r["frigate_modules"] is None:
        return "full", lists
    return ("detail" if lists else "pruned"), lists


# ---- index (TL build_atlas_index.py) ----
INDEX_COLUMNS = ["glyphs", "galaxy", "preset", "rooms", "crates", "footlockers", "floors", "stairs", "hangars", "map"]
INDEX_EXTRA = ["briefcases", "tall_lockers"]
INDEX_REWARD = ["reward_name", "reward_class", "reward_ambiguous", "reward_alt"]
INDEX_FRIGATE = ["frigate_modules", "frigate_modules_ambiguous", "frigate_module_rooms", "frigate_module_ids",
                 "frigate_module_alt_ids"]
BUILD_LINE = re.compile(r"NMS\.exe (\S+) SHA-256 ([0-9A-Fa-f]{64})")
DEFAULT_BUILD = "7.05 13D5060D"


def index_record(line, galaxy, build_tag):
    """One region-format row line -> the record read_atlas() makes of it."""
    rec = next(csv.DictReader([HEADER4, line]))
    rec["glyphs"] = rec["glyphs"].upper()
    rec["galaxy"] = galaxy
    rec["game_build"] = build_tag
    return rec


def index_cells(r, map_bits, mixed):
    """The index cells build() writes for record r (mixed = the index has the per-row game_build column)."""
    return [r["glyphs"], r["galaxy"], *(r[c] for c in INDEX_COLUMNS[2:-1]), map_bits,
            *((r.get(c) or "") for c in INDEX_EXTRA + INDEX_REWARD + INDEX_FRIGATE),
            *([r.get("game_build") or DEFAULT_BUILD] if mixed else [])]


def address(r):
    g = r["glyphs"]
    return f"000{g[1:4]}{r['galaxy']:02X}{g[4:]}"


# ---- extras (TL build_atlas_index.py write_extras) ----
EXTRAS_FORMAT = 2
EXTRAS_COLUMNS = ["address", "spookbox", "spookbox_ambiguous", "spookbox_alt", "items_value", "items_value_min",
                  "items_value_max", "items_nanites", "items_nanites_direct", "items_nanites_refiner", "items_nanites_min",
                  "items_nanites_max", "items_ambiguous", "items_tech", "items_top", "end_reward_value", "spookbox_value",
                  "items_units", "items_units_min", "items_units_max"]     # W28: format 2


def extras_text(values, columns, fmt, what):
    """write_extras() as plain text: '#' line, header `columns`, rows sorted by address; None/'' = empty cell."""
    out = io.StringIO(newline="")
    out.write(f"# nms-derelict-atlas extras format {fmt}: {len(values)} systems; {what}\n")
    w = csv.writer(out, lineterminator="\n")
    w.writerow(columns)
    for a in sorted(values):
        v = values[a]
        w.writerow([a.upper()] + ["" if v.get(c) is None else v.get(c) for c in columns[1:]])
    return out.getvalue()


# ---- v3 line rules (V3UP 2026-11-02, user-approved): the visitor's browser uploads its finished scan results ----
# THE SAME BLOCK is in the Pi relay (relay.py) and in the singles Action (tools/singles/atlas_rules.py), from the line
# "# ---- v3 line rules" to the end of v3_check_extras: keep both copies identical (diff them after a change).
# Columns of an uploaded row / extras line, hard-coded copies of the published headers:
#   V3_ROW_HEADER    = line 2 of index/systems/00.csv of the published atlas (build_atlas_index.py INDEX_COLUMNS +
#                      INDEX_EXTRA + INDEX_REWARD + INDEX_FRIGATE + game_build), checked 2026-11-02
#   V3_EXTRAS_HEADER = build_atlas_index.py EXTRAS_COLUMNS, extras format 3 (= line 2 of views/extras.csv.gz)
V3_ROW_HEADER = ("glyphs,galaxy,preset,rooms,crates,footlockers,floors,stairs,hangars,map,briefcases,tall_lockers,"
                 "reward_name,reward_class,reward_ambiguous,reward_alt,frigate_modules,frigate_modules_ambiguous,"
                 "frigate_module_rooms,frigate_module_ids,frigate_module_alt_ids,game_build")
V3_EXTRAS_HEADER = ("address,spookbox,spookbox_ambiguous,spookbox_alt,items_value,items_value_min,items_value_max,"
                    "items_nanites,items_nanites_direct,items_nanites_refiner,items_nanites_min,items_nanites_max,"
                    "items_ambiguous,items_tech,items_top,end_reward_value,spookbox_value,items_units,items_units_min,"
                    "items_units_max,items_all")
V3_ROW_COLS = V3_ROW_HEADER.split(",")
V3_EXTRAS_COLS = V3_EXTRAS_HEADER.split(",")
V3_MAX_LINE = 4000              # characters per row / extras line
# Integer cells: (lowest, highest, required). highest = ceil(1.5 x the largest value published on 2026-11-02 (index:
# 324,874 rows; extras: the 971 rows of views/extras.csv.gz + 4 singles); for a value group (value/min/max) the group's
# largest); fixed: galaxy 0-255, map 0 (no maps are uploaded), 0/1 flags, frigate modules 0-7 (the most the game has).
# Published maxima: rooms 13, crates 77, footlockers 39, floors 4, stairs 9, hangars 11, briefcases 62, tall_lockers
# 202, frigate_modules_ambiguous 5; items_value* 11,549,394, items_nanites* 4,663, items_ambiguous 126,
# end_reward_value 12,000, spookbox_value 560,000, items_units* 394,623.
V3_ROW_INTS = {"galaxy": (0, 255, True), "rooms": (0, 20, True), "crates": (0, 116, True),
               "footlockers": (0, 59, True), "floors": (0, 6, True), "stairs": (0, 14, True), "hangars": (0, 17, True),
               "map": (0, 0, True), "briefcases": (0, 93, False), "tall_lockers": (0, 303, False),
               "reward_ambiguous": (0, 1, False), "frigate_modules": (0, 7, True),
               "frigate_modules_ambiguous": (0, 7, True)}
V3_EXTRAS_INTS = {"spookbox_ambiguous": (0, 1), "items_value": (0, 17324091), "items_value_min": (0, 17324091),
                  "items_value_max": (0, 17324091), "items_nanites": (0, 6995), "items_nanites_direct": (0, 6995),
                  "items_nanites_refiner": (0, 6995), "items_nanites_min": (0, 6995), "items_nanites_max": (0, 6995),
                  "items_ambiguous": (0, 189), "end_reward_value": (0, 18000), "spookbox_value": (0, 840000),
                  "items_units": (0, 591935), "items_units_min": (0, 591935), "items_units_max": (0, 591935)}
_V3_INT = re.compile(r"0|[1-9][0-9]{0,8}")
_V3_DOTS = re.compile(r"(?:[0-9]{1,3}(?:\.[0-9]{1,3})*)?")
_V3_BOX = r"[0-9]{1,2}x[0-9]{1,2}"
V3_ROW_TEXT = {"glyphs": re.compile(r"0[0-9A-F]{11}"), "preset": re.compile(r"[A-Z0-9_]{1,40}"),
               "reward_class": re.compile(r"[SABC]?"), "frigate_module_rooms": _V3_DOTS,
               "frigate_module_ids": _V3_DOTS, "frigate_module_alt_ids": _V3_DOTS,
               "game_build": re.compile(r"[0-9A-Za-z .-]{0,40}")}
V3_EXTRAS_TEXT = {"address": re.compile(r"000[0-9A-F]{13}"), "spookbox": re.compile("(?:%s)?" % _V3_BOX),
                  "spookbox_alt": re.compile("(?:%s(?:\\|%s)*)?" % (_V3_BOX, _V3_BOX)),
                  "items_tech": re.compile(r"(?:[0-9]{1,4}/[0-9]{1,4}/[0-9]{1,4}/[0-9]{1,4})?")}
V3_EXTRAS_ORDER = (("items_value_min", "items_value", "items_value_max"),
                   ("items_nanites_min", "items_nanites", "items_nanites_max"),
                   ("items_units_min", "items_units", "items_units_max"))
V3_ITEM_AMOUNT = re.compile(r"([0-9]{1,9})=([0-9]{1,9})~?")      # an items entry after its LAST " x": AMOUNT=VALUE[~]
V3_ADDRESS = re.compile(r"000[0-9A-F]{13}")
V3_SCANNER = re.compile(r"[0-9A-Za-z ;:.+_()/=-]{1,200}")       # the page's scan/w29.json version string
V3_FP = re.compile(r"[0-9a-f]{16}")                             # its tables fingerprint
_V3_BAD_ASCII = re.compile(r'[\x00-\x1f\x7f"]')


def v3_chars_ok(s):
    """True when s has no '"', CR, LF or other control / format character (any Unicode category C*)."""
    if s.isascii():
        return not _V3_BAD_ASCII.search(s)
    return '"' not in s and not any(unicodedata.category(ch)[0] == "C" for ch in s)


def _v3_split(line, cols, what):
    if not isinstance(line, str):
        raise ValueError("%s line is not a string" % what)
    if len(line) > V3_MAX_LINE:
        raise ValueError("%s line is longer than %d characters" % (what, V3_MAX_LINE))
    if not v3_chars_ok(line):
        raise ValueError("%s line has a quote or a control character" % what)
    cells = line.split(",")
    if len(cells) != len(cols):
        raise ValueError("%s line has %d cells, want %d" % (what, len(cells), len(cols)))
    return dict(zip(cols, cells))


def _v3_int(r, col, lo, hi, required, what):
    v = r[col]
    if v == "":
        if required:
            raise ValueError("%s %s is empty" % (what, col))
        return None
    if not _V3_INT.fullmatch(v) or not lo <= int(v) <= hi:
        raise ValueError("%s %s is not an integer %d-%d" % (what, col, lo, hi))
    return int(v)


def v3_items(cell, what):
    """[(value, label)] of an items_top / items_all cell ('LABEL xAMOUNT=VALUE[~]' joined by '|'); [] for ''."""
    out = []
    for e in cell.split("|") if cell else []:
        label, sep, rest = e.rpartition(" x")
        m = V3_ITEM_AMOUNT.fullmatch(rest)
        if not (sep and label and m):
            raise ValueError("extras %s has an entry that is not 'LABEL xAMOUNT=VALUE[~]'" % what)
        out.append((int(m.group(2)), label))
    return out


FINDER_MAX = 24                 # FINDER1: the optional v3 "finder" name ("Atlas scout" on the site), after trimming
FINDER_PUNCT = " _.-"           # allowed besides Unicode letters (category L*) and decimal digits (Nd)
PERF_INTS = {"ms": (20, 120000), "p10": (20, 120000), "p90": (20, 120000), "n": (1, 200), "workers": (1, 64)}
PERF_ENUMS = {"speed": ("gentle", "balanced", "max"), "dev": ("phone", "tablet", "pc"), "src": ("contribute", "lookup")}
PERF_PRESETS = ("CARGO_BUGS", "MEDI_BUGS", "MEDI_TURRETS", "CARGO_TURRETS", "CARGO_FLOATERS", "MEDI_FLOATERS",
                "CARGO_SLIME", "MEDI_SLIME", "CARGO_MAZE", "MEDI_MAZE")    # the 10 presets of the published index (2026-11-03)
PERF_MAX_BYTES = 2048           # the perf object as compact UTF-8 JSON


def v3_finder(s):
    """The optional v3 "finder" -> the trimmed name, or "" for none (missing / null / empty after trimming).
    ValueError("finder ...") when it breaks a rule: a string; no control / format character; 1-24 characters of
    Unicode letters, decimal digits, space _ . - ; not digits only; no "@", "://" or "www." (any case)."""
    if s is None:
        return ""
    if not isinstance(s, str):
        raise ValueError("finder must be a string")
    if any(unicodedata.category(c).startswith("C") for c in s):
        raise ValueError("finder must not contain control characters")
    t = s.strip()
    if not t:
        return ""
    if len(t) > FINDER_MAX:
        raise ValueError("finder must be at most %d characters" % FINDER_MAX)
    if "@" in t or "://" in t or "www." in t.lower():
        raise ValueError("finder must not be an e-mail address or a link")
    if not all(c in FINDER_PUNCT or unicodedata.category(c).startswith("L") or unicodedata.category(c) == "Nd"
               for c in t):
        raise ValueError("finder may only hold letters, digits, spaces and _ . -")
    if all(unicodedata.category(c) == "Nd" for c in t):
        raise ValueError("finder must not be digits only")
    return t


def v3_perf(obj):
    """The optional v3 "perf" object (the page's scan speed) -> the same dict, or None when missing.
    ValueError("perf ...") when it breaks a rule: an object of at most 2,048 bytes (compact JSON); keys only ms, p10,
    p90, n, workers, speed, dev, src, by_preset; ms required; ms / p10 / p90 integers 20-120000, n 1-200, workers
    1-64; speed gentle|balanced|max, dev phone|tablet|pc, src contribute|lookup; by_preset an object {PRESET: ms
    20-120000} with keys from PERF_PRESETS."""
    if obj is None:
        return None
    if not isinstance(obj, dict):
        raise ValueError("perf must be an object")
    if len(json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")) > PERF_MAX_BYTES:
        raise ValueError("perf must be at most %d bytes" % PERF_MAX_BYTES)
    if not set(obj) <= set(PERF_INTS) | set(PERF_ENUMS) | {"by_preset"} or "ms" not in obj:
        raise ValueError("perf keys must be ms, p10, p90, n, workers, speed, dev, src, by_preset (ms required)")
    for k, (lo, hi) in PERF_INTS.items():
        if k in obj and (isinstance(obj[k], bool) or not isinstance(obj[k], int) or not lo <= obj[k] <= hi):
            raise ValueError("perf %s must be an integer %d-%d" % (k, lo, hi))
    for k, allowed in PERF_ENUMS.items():
        if k in obj and obj[k] not in allowed:
            raise ValueError("perf %s must be one of %s" % (k, "|".join(allowed)))
    bp = obj.get("by_preset", {})
    if not isinstance(bp, dict):
        raise ValueError("perf by_preset must be an object")
    for p, v in bp.items():
        if p not in PERF_PRESETS:
            raise ValueError("perf by_preset keys must be published presets")
        if isinstance(v, bool) or not isinstance(v, int) or not 20 <= v <= 120000:
            raise ValueError("perf by_preset values must be integers 20-120000")
    return obj


def v3_check_row(line):
    """(ADDRESS16, {column: cell}) of an uploaded index row, or ValueError(reason). The reason names columns only,
    never a cell value (it is shown to the uploader and in issue comments)."""
    r = _v3_split(line, V3_ROW_COLS, "row")
    for col, rx in V3_ROW_TEXT.items():
        if not rx.fullmatch(r[col]):
            raise ValueError("row %s has the wrong form" % col)
    if r["glyphs"][1:4] == "000":
        raise ValueError("row glyphs: system index 000 is not a system")
    ints = {c: _v3_int(r, c, lo, hi, req, "row") for c, (lo, hi, req) in V3_ROW_INTS.items()}
    ids = r["frigate_module_ids"]
    if (len(ids.split(".")) if ids else 0) != ints["frigate_modules"]:
        raise ValueError("row frigate_module_ids does not list frigate_modules modules")
    g = r["glyphs"]
    return "000%s%02X%s" % (g[1:4], ints["galaxy"], g[4:]), r


def v3_check_extras(line):
    """(ADDRESS16, {column: cell}) of an uploaded extras line (format 3; '' = not computed), or ValueError(reason):
    forms, integer ranges, min <= value <= max, nanites = direct + refiner, items_top / items_all entries, items_all
    sorted by value (desc) then label and its values summing to items_value (as build_top_bundle.items_all_cells)."""
    r = _v3_split(line, V3_EXTRAS_COLS, "extras")
    for col, rx in V3_EXTRAS_TEXT.items():
        if not rx.fullmatch(r[col]):
            raise ValueError("extras %s has the wrong form" % col)
    if r["address"][3:6] == "000":
        raise ValueError("extras address: system index 000 is not a system")
    v = {c: _v3_int(r, c, lo, hi, False, "extras") for c, (lo, hi) in V3_EXTRAS_INTS.items()}
    for lo, mid, hi in V3_EXTRAS_ORDER:
        if None not in (v[lo], v[mid], v[hi]) and not v[lo] <= v[mid] <= v[hi]:
            raise ValueError("extras %s <= %s <= %s does not hold" % (lo, mid, hi))
    n, d, f = v["items_nanites"], v["items_nanites_direct"], v["items_nanites_refiner"]
    if None not in (n, d, f) and n != d + f:
        raise ValueError("extras items_nanites is not items_nanites_direct + items_nanites_refiner")
    v3_items(r["items_top"], "items_top")
    ents = v3_items(r["items_all"], "items_all")
    if ents:
        if sorted(ents, key=lambda e: (-e[0], e[1])) != ents:
            raise ValueError("extras items_all is not sorted by value (desc), then label")
        if v["items_value"] is None or sum(e[0] for e in ents) != v["items_value"]:
            raise ValueError("extras items_all values do not sum to items_value")
    return r["address"], r
