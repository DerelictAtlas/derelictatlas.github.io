# tools/singles: publishing visitor-scanned single systems

The workflow `.github/workflows/singles.yml` runs every hour at minute 7 and can also be started by hand
(`workflow_dispatch`). Runs never overlap (`concurrency: singles`; a run started meanwhile waits). Each run does this:

1. Checks that `scan/scan_w29.wasm` and `scan/w29_scan.js` match `scan/w29.json`: the sha256 of both files, and the
   `w29_version()` string the wasm reports. On any mismatch the job fails with exit code 3: nothing is committed and no
   issue is touched. Then checks the region-count files `tools/singles/w29d/` against their pinned sha256 and runs a
   self-test (4 known region counts + 5 known portal-rule answers); any failure there is exit code 4, same effect (see
   "Known system ranges").
2. Reads the open issues labelled `single-scan` through the GitHub API (at most 200, oldest first).
3. Takes the system addresses out of those issues (found and `none` alike). Addresses already in the atlas are
   skipped; addresses outside every known system range are held (see "Known system ranges").
4. Recomputes every remaining address with the site's own W29 WebAssembly scanner under Node, one Node process per
   CPU of the runner. Nothing a visitor sends is used except the address: a `none` claim is recomputed like any other.
5. Writes the results: systems with a derelict as full rows into `singles/` (after the 1,000,000 cap only systems that
   break into a top-100 list; the rest pruned), `index/singles.csv` and `views/singles-extras.csv`; held addresses
   (unknown range, and for now every system without a derelict) into `singles/held.csv`; once scan status 4 is
   verified, systems without a derelict into `singles/none.csv`.
6. Makes one commit and pushes it to `main`.
7. Only after the push has succeeded, it asks for a Pages build, then comments on each finished issue and closes it.

Files:

| file | role |
|---|---|
| `.github/workflows/singles.yml` | schedule, permissions, concurrency, one step (`bash tools/singles/action.sh`) |
| `tools/singles/action.sh` | check-w29 -> fetch issues -> process -> commit/push (3 attempts) -> Pages build -> comment/close |
| `tools/singles/singles.py` | the processor (Python 3 standard library only) |
| `tools/singles/atlas_rules.py` | the scanner's rules copied from its private code (tiers, map lists and their ranking, the post-cap break-in rule, the known-range rule, row check, index row mapping), each with its source line, so they can be kept in sync |
| `tools/singles/scan_many.cjs` | Node helper: scans a list of addresses with `scan/` and prints one JSON line per address |
| `tools/singles/region_count.cjs` | Node helper: the game's system count of a region (stdin `GG REGION8`) and the portal rule with purple unlocked (stdin `V GG REGION8 SSS`), one persistent process per run, stdout one JSON line each |
| `tools/singles/w29d/` | `w29d_rc.wasm` + `w29d_rc.js`: unchanged copies of RE_FULL's W29d region-count port (`re-full/fast/w29d/bin/`, `node/`), pinned by sha256 in `singles.py` (`W29D_FILES`) |

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

### Known system ranges (held addresses)

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
matches the PC's `verify.py`, which accepts 3E8-428 anywhere. Purple in a core region or at a bad coordinate is held;
3E7 (at or above the count) and 429 are held. The portal answer is asked only for a window index, cached per
(galaxy, region, index); the summary field `purple_checks` says how many were asked.

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

Every other address is **held** with reason `range`: written to `singles/held.csv` with the time of the first batch
issue that had it, and retried at every run (after the issue addresses, inside the run cap). An index at or above the
count never becomes valid by itself; it is published only if the PC lists it (`stats/work.txt`, a region file), and
dropped from the list when it is published some other way. The list keeps at most 50,000 addresses (`HELD_MAX`, both
reasons together); beyond that the oldest are dropped. The issue itself is closed normally ("held").

Held reasons (the third column of `held.csv`): `range` (outside every known system range, above) and `status4` (below).

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
| `singles/held.csv` | held addresses with a reason (`range` / `status4`), retried every run (format below); absent when empty |
| `index/singles.csv` | plain-text index rows of every full single row that is not in the main index yet, in the same columns and encoding as the main index, with `map` = 0. Its first two lines are copied unchanged from the main index (the `#` line and the column header). It is NOT listed in `index/manifest.json`. The file is absent when there are no rows |
| `views/singles-extras.csv` | loot extras (items value, nanites, SpookBox, W28 money Units) of the systems in `index/singles.csv`, uncompressed, in extras **format 2** (the columns of `build_atlas_index.py` `EXTRAS_COLUMNS`: format 1 + `items_units`, `items_units_min`, `items_units_max` after `spookbox_value`), also while the live `views/extras.csv.gz` is still format 1 (a newer live format is followed). Cells are filled by name; the units cells are empty for scans made with W29b/c. The file is absent when there are none |

No map views are ever written (W29c's map is skipped: `scan_many.cjs` passes `derelict: false`).

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
`reason` = `range` or `status4`; format 1 rows without a reason are read as `range`):
```
# nms-derelict-atlas singles held format 2: <N> addresses not published yet, retried every run; reason range = outside every known system range (index not below the region's system count, no region file range, not in stats/work.txt), published once valid; reason status4 = the recompute found no derelict (scan status 4), which is not verified yet, retried once it is; first_seen = UTC time of the first batch issue that had it; at most 50000 (oldest dropped)
address,first_seen,reason
0000010002603CE6,2026-10-31T12:42:00Z,range
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
   `atlas_rules.py`, `scan_many.cjs`, `region_count.cjs`, `w29d/w29d_rc.wasm`, `w29d/w29d_rc.js`, `README.md`; not
   the `*.pre-*` backup files; the repo's `.gitattributes` keeps them byte-identical: `*.wasm binary`, the LF `.js`
   unchanged by `eol=lf`, and the sha256 check would stop the run otherwise). `scan/` (`scan_w29.wasm`,
   `w29_scan.js`, `w29.json`) comes from the SITE agent.
2. Repository settings:
   - Actions must be enabled.
   - Settings -> Actions -> General -> Workflow permissions: "Read and write permissions".
   - `main` must allow pushes by `github-actions[bot]` (no branch protection requiring PRs).
   - Pages: deploy from the `main` branch (as today).
3. Create the label `single-scan` (Issues -> Labels).
4. Run the workflow once by hand (Actions -> singles -> Run workflow). Then check:
   - the commit, and that the site picks up `index/singles.csv`;
   - that a Pages build ran after the bot's push. Pushes made with `GITHUB_TOKEN` may not trigger the branch Pages
     build. The workflow therefore also requests one (`POST /pages/builds`, needs `pages: write`); its log line says
     whether that request worked.

## Rollback

- Stop: Actions -> singles -> "..." -> Disable workflow, or delete `.github/workflows/singles.yml`.
- Remove published singles: delete `singles/`, `index/singles.csv` and `views/singles-extras.csv` in one commit.
  Regions and the main index are never touched by this workflow.
