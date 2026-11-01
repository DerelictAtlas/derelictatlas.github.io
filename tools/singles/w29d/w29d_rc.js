// W29d: tiny JS wrapper for w29d_rc.wasm (wasm32 freestanding reactor, no imports, ~tables inside).
//   const rc = await W29dRC.load(bytes);  rc.regionCount(galaxy, x, y, z)  rc.validSystem(galaxy, x, y, z, sys, purple)
//   rc.regionCountUA(hi, lo)  (lo = X | Z<<12 | Y<<24 as uint32, hi = galaxy)
// Address fields: X, Z in -2048..2047 (12-bit two's complement), Y in -128..127 (8-bit), galaxy 0..255, system 0..4095.
(function (root) {
  const VALID = ["valid", "bad_coord", "core", "index_zero", "index_range", "fault"];
  async function load(bytes) {
    const { instance } = await WebAssembly.instantiate(bytes, {});
    const e = instance.exports;
    const lo = (x, y, z) => ((x & 0xfff) | ((z & 0xfff) << 12) | ((y & 0xff) << 24)) >>> 0;
    return {
      regionCountUA: (hi, l) => e.w29d_region_count(hi >>> 0, l >>> 0),
      regionCount: (g, x, y, z) => e.w29d_region_count(g & 0xff, lo(x, y, z)),
      validSystemUA: (hi, l, purple) => e.w29d_valid_system(hi >>> 0, l >>> 0, purple ? 1 : 0),
      validSystem: (g, x, y, z, sys, purple) => {
        const c = e.w29d_valid_system(((g & 0xff) | ((sys & 0xfff) << 8)) >>> 0, lo(x, y, z), purple ? 1 : 0);
        return { code: c, valid: c === 0, reason: VALID[c] };
      },
    };
  }
  const api = { load, VALID };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.W29dRC = api;
})(typeof self !== "undefined" ? self : this);
