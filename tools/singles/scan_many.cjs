/* scan_many.cjs -- scan a list of systems with the site's W29 WebAssembly scanner (Node, no packages).
 *
 *   node scan_many.cjs <scan-dir> <address-file> [--fresh N]
 *
 * <scan-dir>      folder with scan_w29.wasm + w29_scan.js (the site's scan/ folder; tools/singles/singles.py passes it)
 * <address-file>  one ADDRESS16 (16 hex digits) per line; anything else on a line is an error for that line
 * --fresh N       new wasm instance every N systems (default 100): a kept instance grows to ~120 MB over ~1,000
 *                 systems, a fresh one stays near 30 MB (RE_FULL W29b)
 *
 * stdout, one JSON object per line (UTF-8, LF):
 *   first line   {"w29_version": "<w29_version() string>"}
 *   per address  {"address", "status", "seed", "header", "row", "atlas", "extras"}
 *                status = the engine status (0 ok, 1 writer error, 2 loot error, 3 no POI entry, 4 no abandoned
 *                freighter POI = no derelict, 5 POI error, 6 skipped); header/row = the scan.exe CSV header and row
 *                with the four *_us timing cells blanked (so the output is deterministic); atlas = the 21 region-file
 *                format-4 cells (glyphs .. room_detail, check) exactly as scan.exe writes them; extras = every
 *                --spook / --items cell by header name, as the raw CSV strings
 *   or           {"address", "error": "<message>"}   (scan threw; a W29Exit also replaces the instance)
 * Scan options = the scanner's own call: --extra --poi-mode game --opt 0xBF01 --spook --items (W29Scan.DEFAULTS),
 * plus derelict: false = W29c/W29e build no map (result.derelict stays null; the CSV is the same as W29b; W29b ignores
 * the option), plus checkFingerprint: null = W29e's check column uses the engine's 7.05 fingerprint, as scan.exe, W29b
 * and W29c (W29e's default is the hotfix fingerprint; older wrappers ignore the option). No onProgress (W29e).
 * Every cell is taken by its HEADER NAME, never by position: W29e's CSV has 3 more cells (W28 items_units,
 * items_units_min, items_units_max), which arrive in extras; W29b/c simply do not have them.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const WASM_FILE = "scan_w29.wasm";
const JS_FILE = "w29_scan.js";
const OPTIONS = { poiMode: "game", spook: true, items: true, extra: true, opt: 0xBF01, derelict: false,
  checkFingerprint: null };
const ATLAS = ["glyphs", "preset", "rooms", "crates", "footlockers", "floors", "stairs", "hangars", "briefcases",
  "tall_lockers", "reward_name", "reward_class", "reward_ambiguous", "reward_alt", "frigate_modules",
  "frigate_modules_ambiguous", "frigate_module_rooms", "frigate_module_ids", "frigate_module_alt_ids", "room_detail",
  "check"];
const EXTRA_BLOCK = new Set(["address", "seed", "preset_index", "status", "placements", "a2780_calls", "plans",
  "attempts", "writer_us", "search_us", "loot_us", "poi_us"]);
const TIMINGS = new Set(["writer_us", "search_us", "loot_us", "poi_us"]);

function out(obj) { process.stdout.write(JSON.stringify(obj) + "\n"); }

async function main() {
  const args = process.argv.slice(2);
  let fresh = 100;
  const pos = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--fresh") fresh = Math.max(1, parseInt(args[++i], 10) || 100);
    else pos.push(args[i]);
  }
  if (pos.length !== 2) { process.stderr.write("usage: node scan_many.cjs <scan-dir> <address-file> [--fresh N]\n"); process.exit(2); }
  const dir = path.resolve(pos[0]);
  const W29Scan = require(path.join(dir, JS_FILE));
  const mod = await WebAssembly.compile(fs.readFileSync(path.join(dir, WASM_FILE)));
  const lines = fs.readFileSync(pos[1], "utf8").split(/\r?\n/).map((s) => s.trim()).filter((s) => s);
  let sc = await W29Scan.create(mod), used = 0;
  out({ w29_version: sc.version() });
  for (const a of lines) {
    if (!/^[0-9A-F]{16}$/.test(a)) { out({ address: a.slice(0, 32), error: "not an ADDRESS16" }); continue; }
    if (used >= fresh) { sc = await W29Scan.create(mod); used = 0; }
    used++;
    try {
      const raw = sc.scanRaw(a, OPTIONS);
      const h = raw.header.split(","), v = raw.row.split(",");
      if (h.length !== v.length) throw new Error("row/header column count differs");
      const c = {}, extras = {};
      h.forEach((k, i) => {
        if (TIMINGS.has(k)) v[i] = "";
        if (!(k in c)) c[k] = v[i];
        if (!EXTRA_BLOCK.has(k) && !ATLAS.includes(k)) extras[k] = v[i];
      });
      const missing = ATLAS.filter((k) => !(k in c));
      if (missing.length) throw new Error("scan header lacks " + missing.join(" ") + ": " + raw.header.slice(0, 80));
      const atlas = ATLAS.map((k) => c[k]);       // by name (first column of that name), in region-file order
      out({ address: a, status: Number(c.status), seed: c.seed || "", header: raw.header, row: v.join(","), atlas, extras });
    } catch (e) {
      out({ address: a, error: String(e && e.message || e).slice(0, 300) });
      if (e instanceof W29Scan.W29Exit) { sc = await W29Scan.create(mod); used = 0; }
    }
  }
}

main().catch((e) => { process.stderr.write(String(e && e.stack || e) + "\n"); process.exit(1); });
