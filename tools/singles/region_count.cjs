/* region_count.cjs -- the game's region system count + portal rule (RE_FULL W29d port) for the singles Action (Node).
 *
 *   node region_count.cjs <w29d-dir>
 *
 * <w29d-dir>  folder with RE's w29d_rc.wasm + w29d_rc.js, unchanged copies of re-full/fast/w29d/bin/w29d_rc.wasm and
 *             re-full/fast/w29d/node/w29d_rc.js (tools/singles/singles.py checks their sha256 before it starts this)
 *
 * A persistent line server: stdin one query per line "GG REGION8" (2 + 8 upper-case hex digits: galaxy, and the last 8
 * glyph digits YY ZZZ XXX of an ADDRESS16) or "V GG REGION8 SSS" (+ 3 hex digits: system index), stdout one JSON
 * object per line (UTF-8, LF):
 *   first line   {"w29d": "ready"}
 *   per query    {"q": "GG REGION8", "count": N}   N = the region's system count 0..4095 (-1 = fault in the port)
 *                {"q": "V GG REGION8 SSS", "valid": C}   C = w29d_valid_system with purple UNLOCKED: 0 valid,
 *                1 bad_coord, 2 core, 3 index_zero, 4 index_range, 5 fault (planet digit 0, not checked by the port)
 *   or           {"q": "<query, cut>", "error": "<message>"}
 * The query needs no sign conversion: REGION8 = Y<<24 | Z<<12 | X with X, Z 12-bit and Y 8-bit two's complement, which
 * is exactly w29d's ua_lo (X | Z<<12 | Y<<24); ua_hi = galaxy. Same input as the PC's rc_worker.py
 * (region_count_705.region_ua). The wasm is freestanding (no imports) and pure: one instance serves every query.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const readline = require("readline");

function out(obj) { process.stdout.write(JSON.stringify(obj) + "\n"); }

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1) { process.stderr.write("usage: node region_count.cjs <w29d-dir>\n"); process.exit(2); }
  const dir = path.resolve(args[0]);
  const W = require(path.join(dir, "w29d_rc.js"));
  const rc = await W.load(fs.readFileSync(path.join(dir, "w29d_rc.wasm")));
  out({ w29d: "ready" });
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    const q = line.trim();
    if (!q) continue;
    const m = /^([0-9A-F]{2}) ([0-9A-F]{8})$/.exec(q);
    const v = m ? null : /^V ([0-9A-F]{2}) ([0-9A-F]{8}) ([0-9A-F]{3})$/.exec(q);
    if (!m && !v) { out({ q: q.slice(0, 32), error: "not 'GG REGION8' or 'V GG REGION8 SSS'" }); continue; }
    try {
      if (m) out({ q, count: rc.regionCountUA(parseInt(m[1], 16), parseInt(m[2], 16)) });
      else out({ q, valid: rc.validSystemUA((parseInt(v[1], 16) | (parseInt(v[3], 16) << 8)) >>> 0, parseInt(v[2], 16), true) });
    } catch (e) {
      out({ q, error: String(e && e.message || e).slice(0, 300) });
    }
  }
}

main().catch((e) => { process.stderr.write(String(e && e.stack || e) + "\n"); process.exit(1); });
