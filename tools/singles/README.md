# tools/singles: publishing visitor-scanned single systems

The workflow `.github/workflows/singles.yml` runs every hour at minute 7 and can also be started by hand
(`workflow_dispatch`). Runs never overlap (`concurrency: singles`; a run started meanwhile waits). Each run does this:

1. Checks that `scan/scan_w29.wasm` and `scan/w29_scan.js` match `scan/w29.json`: the sha256 of both files, and the
   `w29_version()` string the wasm reports. On any mismatch the job fails with exit code 3: nothing is committed and no
   issue is touched. Then checks the region-count files `tools/singles/w29d/` against their pinned sha256 and runs a
   self-test (4 known region counts + 5 known portal-rule answers); any failure there is exit code 4, same effect (see
   "Known system ranges").
2. Reads the open issues labelled `single-scan` through the GitHub API (at most 200, oldest first), and the open
   report issues (label `report-system`, or a title of exactly one ADDRESS16; see "Report a system").
3. Takes the system addresses out of those issues (found and `none` alike). Addresses already in the atlas are
   skipped; addresses of systems that do not exist in-game are rejected with the reason (see "Known system ranges").
4. Recomputes every remaining address of a v1 / v2 batch with the site's own W29 WebAssembly scanner under Node, one
   Node process per CPU of the runner. Nothing a visitor sends in a v1 / v2 batch is used except the address: a `none`
   claim is recomputed like any other. A **v3 batch** (since 2026-11-02) carries the visitors' finished results: it is
   verified instead (checks + a 1 % rescan sample + conflicts; one mismatch drops the whole batch), see "v3 results
   upload" below. Report issues are rescanned (at most 50 per run).
5. Writes the results: systems with a derelict as full rows into `singles/` (after the 1,000,000 cap only systems that
   break into a top-100 list; the rest pruned), `index/singles.csv` and `views/singles-extras.csv`; for now every
   system without a derelict into `singles/held.csv` (reason `status4`); once scan status 4 is verified, systems
   without a derelict into `singles/none.csv`.
6. Makes one commit and pushes it to `main`.
7. Only after the push has succeeded, it asks for a Pages build, then comments on each finished issue and closes it.

Files:

| file | role |
|---|---|
| `.github/workflows/singles.yml` | schedule, permissions, concurrency, one step (`bash tools/singles/action.sh`) |
| `tools/singles/action.sh` | check-w29 -> fetch issues -> process -> commit/push (3 attempts) -> Pages build -> comment/close |
| `tools/singles/singles.py` | the processor (Python 3 standard library only) |
| `tools/singles/atlas_rules.py` | the scanner's rules copied from its private code (tiers, map lists and their ranking, the post-cap break-in rule, the known-range rule, row check, index row mapping), each with its source line, so they can be kept in sync |
| `tools/singles/maps.py` | MAPS1: adds the maps of listed systems that have none to `views/top100.json(.gz)` + `views/top100-loot.json` (validated, atomic, never fails the run) |
| `tools/singles/map_many.cjs` | Node helper for `maps.py`: scans systems with `scan/` (derelict on) and packs each map with the site's `model.js` |
| `tools/singles/scan_many.cjs` | Node helper: scans a list of addresses with `scan/` and prints one JSON line per address |
| `tools/singles/region_count.cjs` | Node helper: the game's system count of a region (stdin `GG REGION8`) and the portal rule with purple unlocked (stdin `V GG REGION8 SSS`), one persistent process per run, stdout one JSON line each |
| `tools/singles/w29d/` | `w29d_rc.wasm` + `w29d_rc.js`: unchanged copies of RE_FULL's W29d region-count port (`re-full/fast/w29d/bin/`, `node/`), pinned by sha256 in `singles.py` (`W29D_FILES`) |

## Maps of listed systems (MAPS1, 2026-11-06)

After `process` (so after the re-rank) `action.sh` runs `python -I tools/singles/maps.py` once per attempt. Missing set =
every address in `views/map-lists.txt` with no entry in `views/top100.json` "s" (computed fresh every run, so the first
run also fills the systems that were listed before this step existed, and a failed run heals itself next hour).
`map_many.cjs` scans them with the site's own W29 wasm (`scan/`, options of `scan_many.cjs` plus `derelict: true,
loot: true`) and packs each with `model.js` `pack()`, the JavaScript twin of the PC's `tools/derelict_view.py pack()`,
using the piece-table ids of the published bundle. The result is what the PC publish stores: verified on 43 systems
that already had a published map (30 atlas, 13 singles): `view` and `top100-loot.json` entry identical for all 43.
What goes into the files:

- `views/top100.json` / `.json.gz` "s": the view; "k": the system's bits from `map-lists.txt`. Keys stay sorted, JSON
  compact (`separators=(",",":")`, `ensure_ascii=False`), gzip level 9 with mtime 0: with nothing added the same bytes
  come out as the PC wrote (checked), so a run that adds nothing writes nothing.
- `views/top100-loot.json` "views": the W29g per-container loot (`cv` / `xv`) of the new system, when the engine mapped it.
- Never changed: the piece table "t", any existing entry, the 11 entries of systems that are in no list. A system that
  needs a scene the table does not have is skipped (the table also holds wall shapes, which this job does not have);
  it stays in the missing set and is retried each hour.

Safety: the new files are built and validated in memory (parse, every old entry equal, table equal, `.json` ==
gunzip(`.json.gz`)), written to temp files beside the real ones and renamed; an error before the rename, a scanner
failure, a timeout or a bad line from the helper leave every file as it was, and the run commits the singles data as
before (`maps.py` always exits 0; its one line `maps: {...}` is in the log). Limits per attempt: `SINGLES_MAPS_MAX`
(300 maps) and `SINGLES_MAPS_MINUTES` (6 min), never later than the scan deadline + 5 min; the rest is made next hour.
`SINGLES_NO_MAPS=1` skips the step. Cost: about 0.6 s per map, about 5.5 KB JSON / 1.4 KB gzip each (17 maps = +94 KB / +24 KB).
When maps were added the commit message gets a second line `maps: +N map views ...`.

PC publish: it rebuilds the whole bundle from its own layouts (listed singles get a regenerated layout there too), so it
writes the same entries and also drops the dead ones; the two never disagree, but a PC pull that conflicts in the three
files above needs the PC's version kept (the scanner's `RANK_FILES` rule in `atlas.py`, see the coordination file).

## Input: issues

Only **open** issues with the label **`single-scan`** are read; pull requests are skipped. Issue text is untrusted:
it is never put into a shell command, and the only thing ever taken from it is lines that match one of the strict
patterns below. Comments repeat only the addresses that were parsed out, never the issue text.

**Relay batch format v2** (written by the Pi relay since 2026-10-31):

- title: `single-scan batch YYYY-MM-DD HH:MMZ (<n>)` (UTC; the title is not read);
- labels: `["single-scan"]`;
- body: the first line is exactly `single-scan batch v2`. Every further line is exactly one of
  - `ADDRESS16`: the browser found a derelict (upper case `[0-9A-F]{16}`, galaxy included);
  - `none ADDRESS16`: the browser scanned the system and found no derelict;
  - `scanner <token>`: the scanner build that the page used, `<token>` = `[0-9a-f+]{1,40}` (for example
    `0b5e1235+5ca4c66b` = wasm sha256 prefix + js sha256 prefix). Informational only: it is logged and listed in the
    summary, and never decides anything.

  Addresses are unique, at most 3,000 per issue, every line ends in `\n`, the body stays below 65,536 characters
  (the relay splits by count and by size). The relay writes its `scanner` lines right after the first line.

Example body:
```
single-scan batch v2
scanner 0b5e1235+5ca4c66b
00009F0002609CAA
none 00009FFF02609CAA
```

**Relay batch format v3** (since 2026-11-02): see "v3 results upload" below.

**Relay batch format v1** (older relay, still read): the first line is exactly `single-scan batch v1`, then one
ADDRESS16 per line, nothing else (no `none`, no `scanner` lines).

Parsing rules:

- `\r` and empty lines are ignored.
- In a v1 / v2 body, a line that is not exactly one of the forms above is counted as ignored.
- An address that appears both as found and as `none` counts as found (it is recomputed anyway).

**Other issues** (for example filed by hand, with the title `scan <ADDRESS16>`): every line of the title and the body
is trimmed and must be exactly one address, optionally after `scan `. An address is either:

- an ADDRESS16 (16 hex digits, any case), or
- `<galaxy>:<12 glyph hex digits>`, where galaxy is a decimal number from 0 to 255 and the planet glyph is ignored.

Every other line is ignored. Nothing is ever searched inside a longer line.

Note that GitHub only keeps a label on a prefilled "new issue" link when the person filing it may set labels.
Visitors without that right therefore cannot file a `single-scan` issue themselves; the relay can, because it uses
its own token.

An ADDRESS16 has the form `000 SSS GG YY ZZZ XXX`: system index SSS, galaxy GG, then the region YYZZZXXX. Lines that do
not start with `000` are not addresses; system index `000` is "not a valid system".

### Known system ranges (nonexistent addresses)

A made-up system index must not be published, so an address is scanned only when its system index is a system of its
region as the PC atlas sees it (`atlas_rules.system_known`, one function):

- its region has a region file `regions/g<GG>/<YY>/<ZZZ>/<REGION>.csv`, and the index is inside the file's scanned
  range (`# region_systems ...; scanned 001-<top>[ + purple 3E8-428]; ...`) or listed in its `# deferred_systems:` line;
- or `stats/work.txt` lists the region and the index (format below);
- or the index is **below the region's system count**: `1 <= index < count` (since 2026-11-01, W29DW; it replaced the
  interim rule "index <= 0DF");
- or the index is in the **purple window 3E8-428** and the game's portal rule accepts the system with purple unlocked
  (W29d `validSystem(..., purple = true)` is valid), in any region (W29DW-2, 2026-11-01).

The count is the game's own number of systems in the region (index 000 is not a system; core regions have count 0, so
nothing in them is accepted). It comes from RE_FULL's W29d port of the game's count code (`tools/singles/w29d/`,
proven by RE equal to the game run under Unicorn on 6,116 random regions of all 256 galaxies, to all 723 published
`# region_systems` lines, and on the 7.10 hotfix exe). It is the same count, and the same rule, the PC uses: the PC's
region counter (`rc_worker.py`) writes it into every region file as `# region_systems N (portal-valid 001-<N-1>)`, and
the PC's submission check (`verify.py`) accepts a system when `1 <= index < N` (or purple 3E8-428). The PC scans each
region only up to N-9 (an edge margin of 8); the edge systems above that are real and are accepted here (the PC's
fold-in keeps such singles). For every index outside the purple window only the count is used, not W29d's portal rule
`validSystem`, so the Action accepts exactly what the PC accepts. (The portal rule additionally rejects X/Z = -2048
and Y = -128, i.e. glyph digits `800` / `80`, where the count is not 0: no game address has those coordinates, and the
PC does not reject them either.)

Purple systems: the purple window 3E8-428 is the same in every region (RE, the game's FUN_1408234C0, 496/496 cases:
coordinates in range, not a core region, index != 0, then `index < count` OR purple unlocked and `3E8 <= index <= 428`).
A visitor who scanned a purple system has purple unlocked, so an index in the window is accepted when
`validSystem(galaxy, x, y, z, index, true)` is valid, in any region, whether or not a region file lists purple. That
matches the PC's `verify.py`, which accepts 3E8-428 anywhere. Purple in a core region or at a bad coordinate, 3E7
(at or above the count) and 429 do not exist. The portal answer is asked only for a window index (and for the reason
of an address in an empty region), cached per (galaxy, region, index); the summary field `portal_checks` says how many
were asked.

How it runs: `singles.py` starts ONE `node tools/singles/region_count.cjs tools/singles/w29d` per run (also for
`check-w29`), after checking the sha256 of both `w29d/` files (`W29D_FILES`) and before it reads any issue; a self-test
of 4 known counts (`W29D_SELFTEST`: a published region, a core region, two Unicorn reference regions) and 5 known portal
answers (`W29D_PURPLE_SELFTEST`: 3E8 and 428 valid, 429 index_range, core, bad coordinate) must pass. The
query is the address as it is: galaxy = ADDRESS16 digits 7-8, region = the last 8 digits `YYZZZXXX`, which is already
the game's `X | Z<<12 | Y<<24` (two's complement), so no sign conversion is needed. Each (galaxy, region) is counted at
most once per run (cache; about 21 ms per region), and only when the region file / work list do not decide; the
summary field `region_counts` says how many were counted. Any failure (a file changed, Node or the wasm does not start,
the self-test, a count or a portal check fails, no answer within 60 s) stops the run with exit code 4: nothing is
committed, no issue
is touched. There is no fallback rule.

Every other address **does not exist in-game** (user 2026-11-01: "drop them"; the W29d count is exact, so it can never
become valid). It is rejected with outcome `nonexistent` and its reason, not held and not retried:
`does not exist in-game (system index CBE, region has 537 systems)`, or for the purple window and empty regions the
portal rule's reason: `(system index 3E8, galactic core region (no systems))`, `(system index 3E8, region coordinates
outside the galaxy)`. The summary counts it under `nonexistent` (separate from `invalid` = not an address / index
000); the issue comment has one line `- does not exist in-game: N: `ADDRESS` (reason), ...` (at most 100 listed) and
the issue is closed normally.

`singles/held.csv` holds only reason `status4` (below), at most 50,000 rows (`HELD_MAX`; beyond that the oldest are
dropped). Rows with the old reason `range` (written before 2026-11-01, and format 1 rows without a reason) are still
read and re-checked at every run: a system that does not exist in-game is dropped (summary `held_nonexistent_dropped`;
on the live repo this removes `000CBE009616F9D6` and `000CBE009616F9DF`); one that exists is scanned like any held
address (and keeps its row until it is reached inside the run cap).

`stats/work.txt` (written by the PC with the index; SITE `-09` format): `#` comment lines, empty lines, and one region
per line `GG REGION8 <items...>`: GG = galaxy as 2 hex digits, REGION8 = 8 hex digits, items = 3-hex system indexes or
ranges `00D-00E`, separated by single spaces. Lines in any other form are ignored (their count is in the summary). A
missing file means no work list. The Contribute page and the PC subtract `index/singles.csv` and `singles/none.csv`
from it.

### Caps and run time

| what | limit | what happens to the rest |
|---|---|---|
| characters read per issue | 100,000 | not read |
| addresses per issue | 3,000 | reported as "over the limit" |
| addresses to scan per run | 20,000 | issues that would pass this stay open, untouched, for the next run |
| issues per run | 200 | wait for the next run |
| run time for scanning | `SINGLES_SCAN_MINUTES` = 55 minutes after the job started (workflow `timeout-minutes` 90) | see below |
| time per system | 120 s without output from Node | the system counts as "could not be scanned" |

**Carry-over = issues stay open.** When the scanning time is up, no new system is started; systems already done are
committed as usual. An issue with addresses that were not reached is not commented and stays open; the next run reads
it again, finds the finished addresses already published (or in `none.csv` / `held.csv`) and scans only the rest.
Held addresses that were not reached simply stay held. The deadline is computed once per job, so the push retries
below do not get extra scanning time (they reuse the scan cache).

Addresses are deduplicated across the issues of a run. A repeated address is reported as "also in issue #N", and its
issue is closed normally; a relay re-filing a batch is harmless.

**Already published, skipped:**

- a row in `regions/g<GG>/<YY>/<ZZZ>/<REGION>.csv`;
- a `# slim_modules` entry in that file;
- a row of the main index (`index/manifest.json` shards, otherwise `index/systems.csv.gz`);
- a row in `singles/`;
- an address in `singles/none.csv`.

A system listed in `# deferred_systems` is not published yet, so it is scanned.

**Scan results** (found and `none` claims alike):

- status 0: published (a `none` claim that has a derelict is published like a found one; its comment says so);
- status 4 (no abandoned freighter): **not verified yet** (RE job W31 compares the browser engine's status 4 with the
  game; the PC publishes rows for some of these systems). While `NONE_VERIFIED` (in `singles.py`) is `False`, the
  default, the address is neither rejected nor written to `none.csv`: it is held with reason `status4` (first_seen
  kept), is not scanned again while the flag is off, and is dropped from the list when a row for it is published.
  Once the flag is `True`, every `status4` entry is retried and, with status 4 again, recorded in `singles/none.csv`
  (the behaviour described below for `none.csv`);
- any other status, a timeout or a bad check: "could not be scanned", not published, reported on the issue.

## What gets written

| path | content |
|---|---|
| `singles/g<GG>.csv` | the singles of galaxy GG (the Action's own store). Rows are region-file format 4 (`glyphs,...,room_detail,check`); `glyphs` is the full 12-hex portal code |
| `singles/g<GG>/<YY>.csv`, `singles/g<GG>/<YY>/<Z>.csv` | used after a split: when a file passes 1,000,000 bytes, it splits by region layer YY, and then by the first hex digit Z of ZZZ. A split is never undone |
| `singles/manifest.json` | `{"format":1,"rows":N,"split":[...],"files":[{"path","rows","bytes","sha256"}]}` (compact JSON, paths sorted; bucket files only) |
| `singles/none.csv` | systems recomputed with no derelict (format below), only once `NONE_VERIFIED` is on; absent when empty |
| `singles/held.csv` | held addresses with reason `status4`, retried every run (format below; old `range` rows are re-checked and dropped); absent when empty |
| `index/singles.csv` | plain-text index rows of every full single row that is not in the main index yet, in the same columns and encoding as the main index, with `map` = the bits of the map lists the single is in (0 = in none; RANK1, see "Map lists"; > 0 means the viewer expects a map entry in `views/top100.json.gz`, which MAPS1 makes). Its first two lines are copied unchanged from the main index (the `#` line and the column header). It is NOT listed in `index/manifest.json`. The file is absent when there are no rows |
| `views/singles-extras.csv` | loot extras (items value, nanites, SpookBox, W28 money Units) of the systems in `index/singles.csv`, uncompressed, in extras **format 2** (the columns of `build_atlas_index.py` `EXTRAS_COLUMNS`: format 1 + `items_units`, `items_units_min`, `items_units_max` after `spookbox_value`), also while the live `views/extras.csv.gz` is still format 1 (a newer live format is followed). Cells are filled by name; the units cells are empty for scans made with W29b/c. The file is absent when there are none |

Scanning for the rows writes no map (`scan_many.cjs` passes `derelict: false`). Maps of systems that are in a map list are made by a separate step after the re-rank, see "Maps of listed systems (MAPS1)"; it also writes `views/top100.json`, `views/top100.json.gz` and `views/top100-loot.json`.

Every singles bucket file starts with four lines:
```
# nms-derelict-atlas singles format 1: galaxy <G>[ layer <YY>[ group <Z>]]
# generator singles-action 1 (<w29_version>); NMS.exe 7.10-b26295378 SHA-256 D393C678...; <utc>
# inputs c00eb4b1874fb5fe553aff0c39279f6dbcb2cb04fdd08510fe347a98502bacf7
glyphs,preset,...,room_detail,check
```
After them come the rows, sorted by glyphs.

`singles/none.csv` (sorted, unique, never an address that has a row in a region file, the main index or `singles/`):
```
# nms-derelict-atlas singles none format 1: <N> systems with no derelict (scan status 4: no abandoned freighter), each recomputed by the singles Action with the W29 scanner; key = address (ADDRESS16)
address
0000040002603CE8
```

`singles/held.csv` format 2 (sorted by address; `first_seen` = UTC `created_at` of the first batch issue that had it;
`reason` = `status4`; rows of older runs may still say `range`, and format 1 rows without a reason are read as `range`):
```
# nms-derelict-atlas singles held format 2: <N> addresses not published yet, retried every run; reason status4 = the recompute found no derelict (scan status 4), which is not verified yet, retried once it is; reason range = a row of an older run, re-checked every run and dropped when the system does not exist in-game (addresses outside the region's systems are rejected, not held); first_seen = UTC time of the first batch issue that had it; at most 50000 (oldest dropped)
address,first_seen,reason
0000040002603CE8,2026-10-31T12:43:00Z,status4
```

**Rows** (user 2026-10-31: "keep all the data except for maps"; `atlas_rules.keep_tier`):

- Below the cap: every system with a derelict gets its **full row** (all region-file columns incl. `room_detail` and
  `check`), whatever its module count, plus a full `index/singles.csv` row and a `views/singles-extras.csv` row.
  There is no slim tier for singles any more.
- From the cap on (community total >= 1,000,000): a system keeps its full row only when it **breaks into** a top-100
  map list in any category; otherwise it is **pruned**: a row with only `glyphs`, the module count as an upper-case
  letter (A = 0, as in `# slim_modules`) and `check`; no index row, no extras row. A system whose module count is
  unknown cannot be pruned and keeps its full row.
- "Breaks into" (`atlas_rules.breaks_into`, a pure function): for each list of `MAP_LISTS` (the same lists, sort keys
  and tie-breaks as the scanner's `pruning.py` and `build_atlas_index.py`), the current top 100 over every published
  system (main index rows + `index/singles.csv` rows, with the item values of `views/extras.csv.gz` +
  `views/singles-extras.csv` for the two loot lists). The system breaks in when it qualifies for the list (highest
  lists: value > 0; lowest lists: any known value) and the list has fewer than 100 entries or the system ranks
  STRICTLY ahead of the 100th entry (a full tie keeps the incumbent). Systems are ranked in run order, and each system
  that breaks in joins the lists before the next one is ranked.
- The community total = `stats/systems.json total_systems` + the `singles/` rows that are not in the main index yet;
  it grows by one with each accepted system, so the cap can be reached in the middle of a run.

The row body is byte for byte the atlas block that scan.exe writes. The check is
`sha256("<fingerprint>|<body>")[:16]`, computed with the fingerprint of the build stamp `SINGLES_BUILD` =
`7.10-b26295378` (the installed 7.10 hotfix, NMS.exe SHA-256 `D393C678...`; user decision 2026-10-31). The fingerprint
is fastgen's `inputs_fingerprint`: sha256 over `nms-derelict-atlas/<format>/<EXE_SHAS[build]>` + the sha256 digests of
the generator's three input files (copied into `atlas_rules.INPUT_DIGESTS`; the same formula gives the published 7.05
`b93f4648...` and 7.10 `d629f648...`). Before re-signing, the processor verifies the wasm's own check, which uses the
7.05 fingerprint (`scan_many.cjs` passes `checkFingerprint: null` to W29e, whose default would be the hotfix
fingerprint; a row checked with the hotfix fingerprint is accepted too). The index rows carry `game_build` =
`7.10-b26295378 D393C678` (from `SINGLES_BUILD`, not from the wasm's `gameBuild`).

Older stamps are still read: region files stamped 7.05 or 7.10 are checked with their own `# inputs`, and a singles
bucket stamped 7.05 / 7.10 (none exists yet) is read, each row verified with its file's fingerprint and re-signed with
the current stamp (body unchanged), so a bucket file always has one `# inputs` line. A singles row that does not
verify is dropped and listed in the summary (`store_bad_rows`).

**Region supersede:** on every run, a single whose system now has a region row or a slim entry is removed from
`singles/` and its extras are dropped. A region row whose body differs from the single's is listed in the summary as
`superseded_mismatch`. A **main index** row does NOT remove a single: the PC folds singles into the main index at its
publish, and `singles/` stays their source. It only removes the system from `index/singles.csv` and
`views/singles-extras.csv` (the main index row wins anyway), which keeps those two files small.

**Determinism:** the same repo state and the same issues give byte-identical files: LF line endings, UTF-8 without a
BOM, sorted rows, and the same result with 1 or many workers. The only timestamps are the `<utc>` in a bucket's
`# generator` line (set only when that bucket's rows change; it equals the newest `created_at` of the issues in the
run, or `--utc`) and `held.csv`'s `first_seen` (issue `created_at`).

**Commit:** one commit per run, by `atlas-singles-bot` <41898282+github-actions[bot]@users.noreply.github.com>,
with the message `singles: N systems, M without a derelict (run <run id>)`. The workflow only commits when files
changed. Files can also change with N = 0, for example when singles were superseded, held addresses changed or the
main index header changed: `index/singles.csv` must keep the main header, or the site ignores it. When a push is refused
because `main` moved (the PC scanner pushes too), the run takes the new `main` (fetch + reset), recomputes on it (scans
are cached), and pushes again, up to 3 attempts. If all three fail, the job fails and the issues stay open for the next
run.

Scale: one Node process per runner CPU (public-repo runners have 4). About 0.2-0.8 s per system per process (the worst
known system takes about 7 s), so 20,000 addresses take roughly 20-60 minutes; what does not fit into the scanning time
is carried over. At most 20,000 addresses are scanned per hour, so a relay receiving more than that per hour builds a
backlog of open issues (the relay's global limit is 60,000 per hour).

## scan/w29.json (written by the SITE agent with each copy of the scanner)

Key names (constant `W29_KEYS` in `singles.py`):
```json
{"version": "<w29_version() string>", "wasm_sha256": "<sha256 of scan/scan_w29.wasm>", "js_sha256": "<sha256 of scan/w29_scan.js>"}
```
The nested form `{"version": ..., "sha256": {"scan_w29.wasm": ..., "w29_scan.js": ...}}` is also accepted. W29b, W29c
and W29e all work (W29c: `w29c scan wasm; tables 179082 bytes; map 83742 bytes; fingerprint b93f4648ae1ce158`; W29e:
the same with `w29e` and `; check fingerprint <16 hex>` appended). W29e's trailing `; check fingerprint ...` is the
wasm's CURRENT check fingerprint (b93f4648... right after create, c00eb4b1... after a scan with its defaults), so the
comparison ignores that suffix; the sha256 checks still pin both files. `scan_many.cjs` takes every CSV cell by its
header name (W29e has 3 more trailing cells: `items_units`, `items_units_min`, `items_units_max`) and passes no
`onProgress`.

## v3 results upload: verify instead of rescanning (V3UP, user-approved 2026-11-02)

Since 2026-11-02 the browser uploads its FINISHED scan results through the relay (relay README "v3 results upload").
The Action verifies a v3 batch instead of rescanning every system. v1 / v2 batches are processed exactly as before.

**Issue body** (`single-scan batch v3`): the first line is exactly `single-scan batch v3`, then ONE fenced block (a line
```` ``` ````, base64 lines, a line ```` ``` ````; empty lines and `\r` ignored; any other line rejects the issue). The
base64 is gzip (one stream, at most `V3_MAX_RAW` = 4,000,000 bytes unpacked) of ASCII JSON lines, one record per
system: `{"address","fp","scanner","row","extras"}` (a derelict: the index row + extras line the page computed) or
`{"address","fp","scanner","none":true}` (scanned, no derelict). At most 3,000 records are read per issue (the relay
writes at most 2,000).

**Checks, in this order** (a failure of (a), (c) or (d) rejects the WHOLE issue, outcome `rejected`, comment with the
reason, closed; reasons name columns, never echo issue text):

- (a) format + ranges of every record: exact keys, ADDRESS16, `fp` 16 hex, `scanner` form, and the line rules
  `atlas_rules.v3_check_row` / `v3_check_extras` (the same block as the relay's: header cell counts, forms, the
  integer ranges below, no `"` / control / format characters, at most 4,000 characters per line), no address twice;
- (d) consistency: the row's glyphs + galaxy and the extras address are the record's address; `frigate_module_ids`
  lists `frigate_modules` entries; `min <= value <= max` (value, nanites, units); nanites = direct + refiner;
  `items_all` (when filled) parses, is sorted by value then label, and sums to `items_value` (as
  `build_top_bundle.items_all_cells`). Integer ranges (max = ceil(1.5 x the largest value published on 2026-11-02):
  rooms 0-20, crates 0-116, footlockers 0-59, floors 0-6, stairs 0-14, hangars 0-17, briefcases 0-93, tall_lockers
  0-303, frigate_modules and frigate_modules_ambiguous are canonical nonnegative decimal counts matching the exact
  cardinality of frigate_module_ids and frigate_module_alt_ids respectively (no fixed upper bound; row max 4,000
  characters), reward_ambiguous 0-1, map 0, galaxy 0-255;
  items_value* 0-17,324,091, items_nanites* 0-6,995, items_ambiguous 0-189, end_reward_value 0-18,000, spookbox_value
  0-840,000, items_units* 0-591,935, spookbox_ambiguous 0-1; reward_class S/A/B/C/empty;
- (c) scanner: every record's `fp` must be the tables fingerprint of the live `scan/w29.json` version
  (`... tables fingerprint <16 hex>`, or W29c/e `...; fingerprint <16 hex>`; `tables_fp()`), or in `V3_EXTRA_FPS`
  (empty). Otherwise: `rejected` ("scanner tables fingerprint X is not the live scanner's (Y)");
- (b) every address goes through the same classification as a v2 address: already in a region file / the main index
  (**atlas wins**: outcome `already`, nothing compared), index 000 `invalid`, W29d `nonexistent` (with its reason).

**Rescans** (the existing wasm scan path, inside the run cap `MAX_PER_RUN`):

- a **1 % sample** of the issue's new rows (`V3_SAMPLE_PERCENT`; ceil, at least 1 per issue), chosen with
  `random.Random("singles-v3-sample/<issue number>")` from the sorted addresses (deterministic: the same picks on a
  push retry);
- **conflicts**: an address uploaded with different values by two issues of the run (the later one is compared with
  the rescan, the earlier one is upgraded to a rescan too), an upload that differs from the published single
  (`differs from the published single`), and an upload of a held address (`held`); an address uploaded twice with the
  same values is a `duplicate` (no rescan);
- **top lists, only after the cap**: once the community total reaches 1,000,000 (`atlas_rules.post_cap`, the same
  switch as the post-cap pruning, `ATLAS_CAP` = FG pruning.py `ATLAS_CAP`), every new row that would enter a top-100
  map list (`atlas_rules.breaks_into` against the published lists) is rescanned too (`top list`). Below the cap this
  is off (summary `v3.toplist_rescan`);
- `none` records are recomputed like v2 `none` claims (status 4 held while `NONE_VERIFIED` is off; a derelict found
  is published, "reported none").

A rescan equals the upload when every row cell except `map` and `game_build` is equal, and every extras cell the
upload filled (except `items_all`, which the scanner does not write) is equal (`v3_mismatch`). **Any mismatch** (also
"no derelict" or a scan error) **drops the WHOLE issue**: outcome `dropped` for every address, comment "this v3 batch
was dropped: rescan mismatch: `ADDR` (sample): differs in crates", closed, nothing of it published. An issue whose
rescans did not finish before the deadline stays open (`pending`), nothing of it published, and is redone next run.

**Publishing** (unchanged files and formats): an accepted row becomes a singles row from the uploaded cells (region
format 4; `room_detail` empty, because it is not uploaded; a rescanned row keeps the scan's `room_detail`), signed
with `SINGLES_BUILD`; `index/singles.csv` gets the same index row (`map` 0, `game_build` = `7.10-b26295378 D393C678`);
`views/singles-extras.csv` stays format 2 (the format-2 cells of the upload; `items_all` is only used for check (d)).
The post-cap tier rule applies as for scans. An upload that replaced a differing single after a matching rescan is
marked `replaced`. Summary: issue fields `v3_state` (ok / dropped / rejected / pending), `v3_reason`, `v3_rescans`
({address: why}); top-level `v3` (`tables_fp`, `toplist_rescan`, `issues` per state, `rescans`, `verified`).

What it costs: only the sample, conflicts and none claims are scanned (about 1 system per 100 uploaded rows), so a run
handles far more than 20,000 uploaded systems. What it does not catch: a forged row that is not sampled is published
(the chance to catch a batch with k forged rows is about 1 - 0.99^k per batch); a wrong single can be fixed with a
report (below).

## Report a system (report-system issues, V3UP)

A visitor who thinks a system is wrong opens an issue (SITE links `issues/new?template=report-system.md&title=<ADDRESS16>`;
the template sets the label `report-system`, because GitHub drops `?labels=` for visitors without triage rights).
The Action reads **open** issues that have the label `report-system`, and, as a fallback, every open issue WITHOUT the
`single-scan` label whose trimmed title is exactly 16 hex digits (any case). Only the title is used: it must be
exactly one ADDRESS16; the body is free text and is never read or echoed. Issues that already have the label
`report-pc` are skipped (waiting for the scanner agent). At most `REPORT_MAX` = 50 reports are rescanned per run
(oldest first); the rest wait untouched (summary `report_waiting`).

| case | result | issue |
|---|---|---|
| title not one ADDRESS16 | `bad_title` | comment, closed |
| index 000 / does not exist in-game (W29d) | `invalid` / `nonexistent` (with the reason) | comment, closed |
| a singles row, rescan equal | `verified` | "verified, no change", closed |
| a singles row, rescan differs (row cells except room_detail; a stored extras cell) | `replaced`: the single (and its extras) is replaced by the rescan | comment lists `column: old -> new`, closed |
| a PC row (region file row, slim entry or main index row, not a single), rescan equal | `verified` | closed |
| a PC row, rescan differs, or the rescan finds no derelict | `differs` | comment with the changes, left OPEN, label `report-pc` added (`POST /issues/{n}/labels`) |
| not published (also held / none.csv), rescan finds a derelict | `published` | closed |
| not published, rescan finds none (status 4) | `no_derelict` (held while `NONE_VERIFIED` is off) | closed |
| scan error | `error` | closed ("report again later") |
| rescan not reached before the deadline | `pending` | stays open |

The labels `report-system` and `report-pc` must exist in the repo (create both once; GitHub would otherwise create
`report-pc` on the fly when the Action adds it). Summary: `reports` (count per result) and issue entries with
`kind: "report"`, `result`, `changes`, `close`, `add_label`.

A report whose body line 1 is the relay's `Reasons: ...` line and lists `name` (FINDER1: an offensive finder name)
clears nothing automatically: after the normal rescan (results as above; not for bad_title / invalid / nonexistent /
pending) the issue gets the label `report-pc`, stays OPEN, and the comment ends "Finder name reported; the atlas owner
checks it (tools/singles/finder_block.txt)." (summary `reports_name`, issue field `name_reported`). Only that one line
of the body is read, never echoed.

## Finder names and scan speed (FINDER1, 2026-11-03)

A v3 upload may carry a `finder` name (the site shows it as "Atlas scout: NAME") and a `perf` object (relay README
"v3 results upload"). The relay already rejects bad ones; the Action checks them again with the same code
(`atlas_rules.v3_finder` / `v3_perf`) and DROPS an invalid one from its record (the batch is never rejected for it).

**`views/finders.csv`** (public; removed while empty): line 1 `address,finder,found_utc`, line 2 a `#` line (format 1,
the rules), then one row per address sorted by address: `ADDRESS16,<finder>,<YYYY-MM-DDTHH:MM:SSZ>` (found_utc = the
created time of the v3 issue that published it). Rules, every run:

- an address gets a finder only when THIS run publishes it from a v3 issue (outcome `accepted`, not `replaced`) whose
  record carries a valid finder, and only when it has none yet: the first one wins, later uploads never overwrite it
  (a re-upload of a published system is `already` / `duplicate` anyway);
- a system of the PC atlas never has a finder: rows whose address is no longer a single (region file, slim entry or
  main index row; e.g. after a PC fold-in) are removed (summary `finders.not_single`);
- `tools/singles/finder_block.txt` (hand-edited, committed by the owner): one entry per line, an ADDRESS16 (any case)
  or `name:<finder>` (case-insensitive, compared after trimming); `#` lines and anything else are ignored. Blocked rows
  are removed from finders.csv on every run (`finders.blocked`) and a blocked name is never stored again
  (`finders.name_blocked`; the system itself is still published);
- a dropped / rejected / pending batch adds nothing. Summary `finders` = {added, blocked, not_single, name_blocked,
  total}.

**`stats/speed.json`** (public, cumulative, written only when a run adds perf): the `perf` of every record of every
ACCEPTED v3 issue (state ok) of the run. Document: `format` 1, `updated` (run time), `batches` (uploads with perf),
`systems` (sum of their `n`, 1 when missing), `note`, and the groups `overall`, `by_dev` {phone, tablet, pc},
`by_speed` {gentle, balanced, max}, `by_preset` {PRESET}. Each group: `avg` (exact weighted mean), `min`, `max`
(exact), `p10` / `p50` / `p90` (from the histogram: the middle of the bin, clamped to min..max, about +-7 %), and the
running state `n` (weight), `sum` (weighted ms), `hist` (64 log-spaced bins 20-120,000 ms). Running sums + a
histogram, NO samples are kept. overall / by_dev / by_speed add each upload's median `ms` with weight `n`;
by_preset adds each `by_preset` value with weight 1. Values outside 20-120,000 ms are dropped. Nothing else is stored
(no address, name, time per upload or device detail). A stored file with a broken group restarts that group.

`action.sh` allows exactly these two new outputs besides singles/, index/singles.csv and views/singles-extras.csv.

## Map lists: singles rank like atlas systems (RANK1, 2026-11-03)

After writing `index/singles.csv` and `views/singles-extras.csv`, every run re-ranks the 17 map lists
(`tools/singles/rerank.py`, called from `process`; LISTS2 2026-11-08 appended Most containers, bit 262144, after Most
nanites (bit 131072 stays unused), SHIPS 2026-11-09 Most ships, bit 524288, after it (value from
`views/ships.csv.gz`, written by the PC publish; a system without an entry is not counted and never enters):
every run ranks the whole atlas, so the first run after the update fills them),
exactly as the PC publish (`build_atlas_index.build`) does on the
same files: candidates = the main index rows + the singles rows (a single never duplicates an index row), item values
from `views/extras.csv.gz` + `views/singles-extras.csv`, incumbents from `views/top100.json.gz` "k" +
`views/map-lists.txt`. It rewrites `views/map-lists.txt`, the `maps` and `map_lists` parts of `stats/systems.json`
(cut keys; the totals and tiers stay atlas-only) and the `map` column of `index/singles.csv`. The functions are a
verbatim copy of the scanner's (the scanner's tests compare the source and the output bytes). No maps are made here:
the re-rank itself makes no maps: the map step that follows in the same run (MAPS1, below) adds the missing ones to
`views/top100.json.gz`. A system pushed out of every list loses its `map-lists.txt` line (its bundle entry stays; the next PC
publish drops it). A re-rank error never stops the run (summary `rerank.error`); summary `rerank` gives
the number of singles in lists. `action.sh` allows `views/map-lists.txt`, `stats/systems.json` and (MAPS1) `views/top100.json`, `views/top100.json.gz`, `views/top100-loot.json` as outputs. When
the PC pushes after such a commit, its pull keeps the PC's version of these two files (the next run re-ranks again).

## Run locally

Requires Python 3.10+ and Node 18+. Nothing calls GitHub when an issues file and `--dry-run` are given.

```
python -I tools/singles/singles.py check-w29 --repo <atlas copy>      # 2 lines: w29_version(), W29d self-test 9/9 ok
python -I tools/singles/singles.py process --repo <atlas copy> --issues-file issues.json --summary summary.json \
       [--cache scan-cache.jsonl] [--workers N (0 = all CPUs)] [--utc 2026-10-31T12:00:00Z] [--deadline <epoch s>] \
       [--split-bytes N] [--community-total N] [--atlas-cap N] [--none-verified]
python -I tools/singles/singles.py comment --summary summary.json --dry-run calls.jsonl
```

`--split-bytes`, `--community-total`, `--atlas-cap` (a lowered cap) and `--none-verified` (forces `NONE_VERIFIED` on)
exist for tests only. `issues.json` is a list of
GitHub issue objects (`number`, `state`, `labels`, `created_at`, `title`, `body`). The whole step, including git, runs
against a throwaway clone with:
```
SINGLES_ISSUES_FILE=issues.json SINGLES_DRY_RUN=calls.jsonl SINGLES_WORK=work PYTHON=python bash tools/singles/action.sh
```
(`SINGLES_WORKERS` overrides the number of Node processes, `SINGLES_SCAN_MINUTES` the scanning time.)

A fresh wasm instance is used every 100 systems, which keeps memory under about 60 MB per Node process.

## Deploy

1. Commit these files to `main`: `.github/workflows/singles.yml` and `tools/singles/` (`action.sh`, `singles.py`,
   `atlas_rules.py`, `rerank.py`, `maps.py`, `map_many.cjs`, `scan_many.cjs`, `region_count.cjs`, `w29d/w29d_rc.wasm`, `w29d/w29d_rc.js`, `README.md`; not
   the `*.pre-*` backup files; the repo's `.gitattributes` keeps them byte-identical: `*.wasm binary`, the LF `.js`
   unchanged by `eol=lf`, and the sha256 check would stop the run otherwise). `scan/` (`scan_w29.wasm`,
   `w29_scan.js`, `w29.json`) comes from the SITE agent.
2. Repository settings:
   - Actions must be enabled.
   - Settings -> Actions -> General -> Workflow permissions: "Read and write permissions".
   - `main` must allow pushes by `github-actions[bot]` (no branch protection requiring PRs).
   - Pages: deploy from the `main` branch (as today).
3. Create the labels `single-scan`, `report-system` and `report-pc` (Issues -> Labels).
4. Run the workflow once by hand (Actions -> singles -> Run workflow). Then check:
   - the commit, and that the site picks up `index/singles.csv`;
   - that a Pages build ran after the bot's push. Pushes made with `GITHUB_TOKEN` may not trigger the branch Pages
     build. The workflow therefore also requests one (`POST /pages/builds`, needs `pages: write`); its log line says
     whether that request worked.

## Rollback

- Stop: Actions -> singles -> "..." -> Disable workflow, or delete `.github/workflows/singles.yml`.
- Remove published singles: delete `singles/`, `index/singles.csv` and `views/singles-extras.csv` in one commit.
  Regions and the main index are never touched by this workflow (RANK1: it re-ranks `views/map-lists.txt` and the
  map-list part of `stats/systems.json`; the next PC publish rewrites both).
