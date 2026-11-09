/* map_many.cjs -- make the map views (views/top100.json "s" entries) of a list of systems with the site's W29 scanner.
 *
 *   node map_many.cjs <scan-dir> <address-file> <bundle.json> [--fresh N] [--deadline EPOCH_MS] [--max N]
 *
 * <scan-dir>    the site's scan/ folder (scan_w29.wasm + w29_scan.js); ../model.js (the site's own DerelictModel) is used
 * <address-file> one ADDRESS16 per line
 * <bundle.json> the published views/top100.json: only its piece table "t" is read. A view stores each placed piece as an
 *               id of that table, so a map is only made when every scene it uses is already in the table (the table
 *               also holds the wall / fixture shapes, which this job does not have); otherwise {"address","error"}.
 * --deadline    no new system is started after this time (ms since epoch); --max N: at most N systems
 *
 * The map is what the site draws on a visitor's device and what the PC publish stores: W29c's derelict object (with its
 * extra containers) -> DerelictModel.pack(d, sceneId), the JavaScript twin of tools/derelict_view.py pack() (byte
 * identical by that tool's --verify). Options are scan_many.cjs's, plus derelict: true.
 *
 * stdout, one JSON object per line: first {"w29_version"}; then per address {"address","view","loot"} or {"address","error"};
 * last {"done": N, "stopped": "" | "deadline" | "max"}. Never reads anything but the three inputs; writes nothing.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const OPTIONS = { poiMode: "game", spook: true, items: true, extra: true, opt: 0xBF01, derelict: true, loot: true,
  checkFingerprint: null };

function out(obj) { process.stdout.write(JSON.stringify(obj) + "\n"); }

async function main() {
  const args = process.argv.slice(2);
  let fresh = 100, deadline = Infinity, max = Infinity;
  const pos = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--fresh") fresh = Math.max(1, parseInt(args[++i], 10) || 100);
    else if (args[i] === "--deadline") deadline = Number(args[++i]) || Infinity;
    else if (args[i] === "--max") max = Math.max(0, parseInt(args[++i], 10) || 0);
    else pos.push(args[i]);
  }
  if (pos.length !== 3) { process.stderr.write("usage: node map_many.cjs <scan-dir> <address-file> <bundle.json> [--fresh N] [--deadline MS] [--max N]\n"); process.exit(2); }
  const dir = path.resolve(pos[0]);
  const Model = require(path.join(dir, "..", "model.js"));
  const W29Scan = require(path.join(dir, "w29_scan.js"));
  const mod = await WebAssembly.compile(fs.readFileSync(path.join(dir, "scan_w29.wasm")));
  const table = JSON.parse(fs.readFileSync(pos[2], "utf8")).t;
  const ids = new Map(table.n.map((n, k) => [n, k]));
  const lines = fs.readFileSync(pos[1], "utf8").split(/\r?\n/).map((s) => s.trim()).filter((s) => s);
  let sc = await W29Scan.create(mod), used = 0, done = 0, stopped = "";
  out({ w29_version: sc.version() });
  for (const a of lines) {
    if (done >= max) { stopped = "max"; break; }
    if (Date.now() >= deadline) { stopped = "deadline"; break; }
    done++;
    if (!/^[0-9A-F]{16}$/.test(a)) { out({ address: a.slice(0, 32), error: "not an ADDRESS16" }); continue; }
    if (used >= fresh) { sc = await W29Scan.create(mod); used = 0; }
    used++;
    try {
      const r = sc.scan(a, OPTIONS);
      if (r.status !== 0 || !r.derelict) { out({ address: a, error: "scan status " + r.status + (r.derelict ? "" : ", no layout") }); continue; }
      if (r.derelict.address !== a) throw new Error("layout address differs");
      const view = Model.pack(r.derelict, (n) => { if (!ids.has(n)) throw new Error("scene not in the piece table: " + n); return ids.get(n); });
      // W29g loot (the Quick Run per-container values, the top100-loot.json entry): null when the engine could not map it
      const loot = r.loot && !sc.lootError() && Array.isArray(r.loot.cv) ? { cv: r.loot.cv, ...(r.loot.xv ? { xv: r.loot.xv } : {}) } : null;
      out({ address: a, view, loot });
    } catch (e) {
      out({ address: a, error: String(e && e.message || e).slice(0, 300) });
      if (e instanceof W29Scan.W29Exit) { sc = await W29Scan.create(mod); used = 0; }
    }
  }
  out({ done, stopped });
}

main().catch((e) => { process.stderr.write(String(e && e.stack || e) + "\n"); process.exit(1); });
