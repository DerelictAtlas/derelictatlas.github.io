# NMS Derelict Atlas

Predicted derelict-freighter layouts for No Man's Sky 7.05 (Euclid galaxy), generated offline
by running the game's own layout code. It covers rooms, salvage crates and footlockers per system.

## Using it

Every scanned region has one file (header `# nms-derelict-atlas format 1` or `2`; format 2 adds `briefcases` and `tall_lockers` after `hangars`): `regions/g<galaxy>/<YY>/<ZZZ>/<REGION>.csv`. REGION is the last 8
portal-glyph digits (YY ZZZ XXX). Each row is one star system:

| column | meaning |
|---|---|
| `glyphs` | portal glyph code (12 hex digits; the first digit is the planet, which doesn't affect the derelict) |
| `preset` | derelict type, for example CARGO_FLOATERS or MEDI_BUGS |
| `rooms`, `crates`, `footlockers` | room count, salvage crates and crew footlockers |
| `floors`, `stairs`, `hangars` | levels used, staircase pieces and hangar pieces |
| `briefcases`, `tall_lockers` | the two other lootable props (format 2 files only; empty = not counted yet). Filled for every system scanned from 2026-10-21 and for all systems with 60+ crates + footlockers |
| `room_detail` | per room in the generator's order: `TEMPLATE:crates/footlockers`, joined with `|` |
| `check` | row fingerprint: the first 16 hex digits of SHA-256(`inputs` fingerprint + `|` + row) |

Hex digit to glyph: 0 sunset, 1 bird, 2 face, 3 diplo, 4 eclipse, 5 balloon, 6 boat, 7 bug, 8 dragonfly,
9 galaxy, A voxel, B fish, C tent, D rocket, E tree, F atlas.

Only systems sure to exist are listed. The game's own region star count gives the valid range; the last 8
systems below that edge are left out unless a visit confirmed them (see each file's header).

A file with a `# status partial` header line is an unfinished region: the rows it has are real and verified,
and the `# not generated` line lists the systems still missing. Scanners take partial regions first and
replace the file with the complete region when it's done.

## Index and top-100 maps

- `index/systems.csv.gz`: every published system in one gzip CSV (glyphs, galaxy, preset, rooms, crates,
  footlockers, floors, stairs, hangars, map). It's a convenience copy built from `regions/`, which stay the
  verified source.
- `views/top100.json.gz`: full maps of the 100 best systems by total containers (salvage crates + footlockers;
  ties go to more crates, then the lower glyph code). It holds rooms, placed pieces, and every crate and
  footlocker with its room and position (layout space, centimetres). Systems with `map` = 1 in the index are in
  it. When a newly scanned system beats one of the 100, the bundle is rebuilt without the system it pushed out.

Both files are rebuilt and committed together with every region upload. They're deterministic, so an unchanged
file isn't rewritten.

## Maps for two top lists

The `map` column of `index/systems.csv.gz` is 0 (no map), 1 (top 100 by crates + footlockers), 2 (top 100 by predicted
frigate modules, ties by the same crate rank) or 3 (in both lists). `views/top100.json.gz` holds the full map of every
system with `map` > 0, each stored once, plus `k` (the same 1/2/3 mark per system). The file name is kept for
compatibility. `s/<ADDRESS16>.html` + `.png` are link-preview cards for those systems (tools/build_share_cards.py).

## Viewer site

The viewer is also published from the repo root (GitHub Pages: `index.html`, `app.js`, ...). It is a private test
site behind a soft password gate (`config.js`, `gate` flag) and not indexed (`robots.txt`). It uses only lookalike
glyph drawings (`glyphs-svg/`), no game assets.

## Credits

- **NMS-Shipwright** by Shikhar Tiwari (https://github.com/S-T-0-7/NMS-Shipwright, MIT). Its Unicorn emulation
  harness (`emu.py`) is the base of this project's generator emulation, which produces the layouts in this atlas.
- **three.js** (MIT) draws the 3D view on the site.
- **nms_namegen** by hadsh (https://github.com/hadsh/nms_namegen, MIT; original by Stuart Coyle, co-authored with
  GoodGuysFree). The viewer's system names come from a JavaScript port of its naming part (`names.js`, with its data in
  `names-data.json.gz`). Names are computed in the browser from the address, are not stored in the atlas, and are unverified.

Links to (external, not affiliated; no data is taken from them): NMS Almanac (https://nmsalmanac.com) and the NMS Hub
galactic map (https://map.nomansskyhub.app, by elegra1965).

This is an unofficial fan project. Not affiliated with Hello Games. No Man's Sky is a trademark of Hello Games Ltd.

## Authenticity

Everything in `regions/` is verified. Each file's `# inputs` header is a SHA-256 over the format, the
NMS.exe build hash and the generator's input data, and every row carries a `check` computed from it.
Rows from another game build, corrupted rows and hand-edited rows fail at once.

A hash can't prove data is real, though: anyone with the code can compute one. The real proof is that each
layout is fully determined by its address. Submitted files are therefore re-generated on a trusted machine
for a random sample of systems (25% by default, chosen with fresh OS randomness after the submission
arrives), and a single mismatch rejects the whole file. Every listed system must also exist (the game's
own region star count). Accepted files get a `# verified` header line.

**Submitting:** open a pull request that adds `submissions/g<galaxy>/<REGION>.csv` in the format above,
produced by the generator with the same `inputs` fingerprint. The maintainer's tool verifies it, comments
the result on the PR, and publishes accepted regions to `regions/`.

## Coordination

`claims/` holds regions a scanner is working on right now (each claim expires after 6 hours).
`atlas.json` sets the scan order.

Blind predictions at new systems have matched the live game, both the seed and preset in a live capture
and the first room's container count in-game.
