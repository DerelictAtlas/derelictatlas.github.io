/* site-preset.js (SITE v159): which derelict TYPE (FreighterDungeons preset) a system has, from its address alone, without a scan.
 * A port of the scanner app's derelict_seed_preset_705.py (about 3 us there): pack the address, mix it into the writer seed, and
 * run the weighted chooser (same float32 steps). Checked against the preset the scan itself reports (fast_check.mjs).
 *   dvPreset.of("00009F0002609CAA") -> "MEDI_TURRETS" ;  dvPreset.NAMES ;  dvPreset.SLOW (the two TURRETS types)
 * Used only by Contribute's "Fast first": it decides WHICH systems are scanned first. It never changes what a scan returns. */
(function (root) {
  const NAMES = ["MEDI_TURRETS", "MEDI_FLOATERS", "MEDI_BUGS", "MEDI_SLIME", "MEDI_MAZE", "CARGO_TURRETS", "CARGO_FLOATERS", "CARGO_BUGS", "CARGO_SLIME", "CARGO_MAZE"];
  const W = [0.66, 0.33, 1.0, 0.25, 0.15, 0.66, 0.33, 1.0, 0.25, 0.15].map(Math.fround);
  const M = (1n << 64n) - 1n, K1 = 0x64DD81482CBD31D7n, K2 = (-0x1C955A39EC9ED669n) & M;
  const C = new DataView(new ArrayBuffer(8)); [0, 0, 0x10, 0, 0, 0, 0xF0, 0x3D].forEach((b, i) => C.setUint8(i, b));
  const CD = C.getFloat64(0, true);
  let TOTAL = Math.fround(0); for (const x of W) TOTAL = Math.fround(TOTAL + x);
  const sg = (v, bits) => (v >= (1 << (bits - 1)) ? v - (1 << bits) : v);
  const cl = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  function index(address) {
    const a = String(address).trim().toUpperCase();
    if (!/^[0-9A-F]{16}$/.test(a)) return -1;
    const raw = BigInt("0x" + a);
    const x = cl(sg(Number(raw & 0xFFFn), 12), -0x7FF, 0x7FF), z = cl(sg(Number((raw >> 12n) & 0xFFFn), 12), -0x7FF, 0x7FF), y = cl(sg(Number((raw >> 24n) & 0xFFn), 8), -0x7F, 0x7F);
    const planet = Number((raw >> 52n) & 0xFn), system = Number((raw >> 40n) & 0xFFFn), reality = Number((raw >> 32n) & 0xFFn);
    const low = ((x & 0xFFF) | ((z & 0xFFF) << 12) | ((y & 0xFF) << 24)) >>> 0, high = (reality | (system << 8) | (planet << 20)) >>> 0;
    let s = (BigInt(high) << 32n) | BigInt(low);
    s = (((s >> 33n) ^ s) * K1) & M;
    s = (((s >> 33n) ^ s) * K2) & M;
    s = (s >> 33n) ^ s;
    const lo = Number(s & 0xFFFFFFFFn), hi = Number(s >> 32n), n = lo + (lo === 0 ? 1 : 0);
    const u = ((((lo >>> 16) | (lo << 16)) >>> 0) ^ hi ^ lo) >>> 0;
    const rv = (Math.imul(n >>> 0, 0x5A76F899) + u) >>> 0;
    const r = Math.fround(rv * CD), thr = Math.fround(r * TOTAL), cnt = W.length;
    let cum = W[0], idx = 0, k = 0;
    while (cum < thr && k < cnt) { cum = Math.fround(cum + (k + 1 < cnt ? W[k + 1] : 0)); idx++; k++; }
    return Math.min(idx, cnt - 1);
  }
  const api = { index, of: (a) => { const i = index(a); return i < 0 ? "" : NAMES[i]; }, NAMES, SLOW: ["MEDI_TURRETS", "CARGO_TURRETS"] };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.dvPreset = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
