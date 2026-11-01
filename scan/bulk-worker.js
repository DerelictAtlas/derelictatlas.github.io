/* bulk-worker.js (SITE integration, user 2026-10-31 "Contribute" page): scans many systems with one scanner instance
 * (checked: the same results as a fresh instance per system). The page sends {address} and replaces the worker every
 * few hundred systems, so its memory stays flat. Only the numbers the page shows are posted back (no map). */
const V = new URL(self.location.href).searchParams.get("v") || "";
const q = V ? "?v=" + encodeURIComponent(V) : "";
importScripts("w29_scan.js" + q);
let scanner = null;
async function load() {
  const response = await fetch("scan_w29.wasm" + q).catch((e) => { throw new Error("downloading the scanner (scan_w29.wasm): " + e.message); });
  if (!response.ok) throw new Error("downloading the scanner (scan_w29.wasm): HTTP " + response.status);
  return W29Scan.create(await response.arrayBuffer());
}
self.onmessage = async (event) => {
  const address = String(event.data && event.data.address || "");
  try {
    if (!scanner) scanner = load();
    const sc = await scanner, r = sc.scan(address, { loot: false }), row = r.row || {}, ex = r.extras || {};
    self.postMessage({ ok: true, address, status: r.status, ms: r.ms, version: sc.version(), row: r.status === 0 ? {
      frigate_modules: row.frigate_modules, frigate_modules_ambiguous: row.frigate_modules_ambiguous, crates: row.crates,
      footlockers: row.footlockers, briefcases: row.briefcases, tall_lockers: row.tall_lockers, rooms: row.rooms, floors: row.floors,
      stairs: row.stairs, hangars: row.hangars,
      reward_name: row.reward_name, reward_class: row.reward_class, preset: row.preset, items_value: ex.items_value, items_nanites: ex.items_nanites } : null });
  } catch (error) {
    scanner = null;
    self.postMessage({ ok: false, address, error: String(error && error.message || error) });
  }
};
