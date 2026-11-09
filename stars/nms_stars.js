// Star list builder for one No Man's Sky region, as WebAssembly. Runs with no server and no game file.
// Results were compared with the project's emulator of build 7.10, not with the running game. See REPORT.md.
//
//   import { createStarBuilder, startStarWorker } from "./nms_stars.js";
//   const b = await createStarBuilder();                 // main thread, fine for one region
//   const region = b.buildRegion(gal, x, y, z);          // signed X, Y, Z; each is masked to its width
//   const view = startStarWorker();                      // preferred on a page: never blocks
//   for await (const r of view.buildView(gal, x, y, z)) draw(r);
//
// Needs WebAssembly SIMD and bulk memory (Chrome 91, Edge 91, Firefox 89, Safari 16.4 or newer). The worker form also needs module workers
// (Firefox 114 or newer). A code path never seen during the build throws an Error naming its address; it never returns a guessed list.

export const COLOR_NAMES = ["yellow", "red", "green", "blue", "purple", "unknown"];
const COLORS = [[1.000, 0.813, 0.063], [0.947, 0.043, 0.224], [0.245, 0.937, 0.073], [0.296, 0.521, 1.000], [0.563, 0.246, 1.000]];
const TRAP_KINDS = { 0: "engine fault", 1: "breakpoint instruction", 2: "divide form", 3: "call never traced", 4: "instruction not translated",
  5: "code path never traced", 6: "indirect target never traced", 7: "pow with a non-finite argument", 8: "write below stack", 9: "address out of range" };

export function regionSeedHex(gal, x, y, z) {
  const hi = (gal & 0xFF).toString(16).padStart(8, "0");
  const lo = (((y & 0xFF) << 24 | (z & 0xFFF) << 12 | (x & 0xFFF)) >>> 0).toString(16).padStart(8, "0");
  return (hi + lo).toUpperCase();
}

export function colorIndex(r, g, b) {
  for (let i = 0; i < COLORS.length; i++) {
    const c = COLORS[i];
    if (Math.abs(r - c[0]) < 0.01 && Math.abs(g - c[1]) < 0.01 && Math.abs(b - c[2]) < 0.01) return i;
  }
  return 5;
}

// One star as a plain object, UA as 16 upper-case hex digits, the emulator's format.
export function starAt(region, i) {
  const p = region.positions;
  return { index: region.index[i], x: p[3 * i], y: p[3 * i + 1], z: p[3 * i + 2], color: COLOR_NAMES[region.color[i]],
    ua: region.ua[i].toString(16).toUpperCase().padStart(16, "0") };
}

async function loadInstance(source) {
  const imports = { env: { tb() {} } };
  if (source === undefined) source = new URL("./nms_stars.wasm", import.meta.url);
  if (source instanceof URL || typeof source === "string") {
    const resp = await fetch(source);
    if (!resp.ok) throw new Error("nms_stars.wasm: HTTP " + resp.status);
    if (WebAssembly.instantiateStreaming && (resp.headers.get("content-type") || "").startsWith("application/wasm")) {
      return (await WebAssembly.instantiateStreaming(resp, imports)).instance;
    }
    source = await resp.arrayBuffer();
  }
  if (source instanceof WebAssembly.Module) return WebAssembly.instantiate(source, imports);
  return (await WebAssembly.instantiate(source, imports)).instance;
}

// source: omitted (fetches nms_stars.wasm beside this file), a URL, bytes, or a compiled WebAssembly.Module.
export async function createStarBuilder(source) {
  const inst = await loadInstance(source);
  const w = inst.exports;
  const rc = w.nms_init();
  if (rc !== 0) throw new Error("nms_stars init failed: " + rc);

  function call(gal, x, y, z) {
    try {
      return w.nms_build(gal >>> 0, x | 0, y | 0, z | 0);
    } catch (e) {
      const kind = w.nms_trap_kind();
      const pc = ((BigInt(w.nms_trap_pc_hi() >>> 0) << 32n) | BigInt(w.nms_trap_pc_lo() >>> 0)).toString(16);
      throw new Error(`star builder stopped: ${TRAP_KINDS[kind] || kind} at ${pc}, region ${regionSeedHex(gal, x, y, z)} (${e.message})`);
    }
  }

  function buildRegion(gal, x, y, z) {
    const n = call(gal, x, y, z);
    if (n < 0) throw new Error("star builder: position and address lists differ in length, region " + regionSeedHex(gal, x, y, z));
    const positions = n ? new Float32Array(w.memory.buffer.slice(w.nms_pos(), w.nms_pos() + 12 * n)) : new Float32Array(0);
    const ua = n ? new BigUint64Array(w.memory.buffer.slice(w.nms_ua(), w.nms_ua() + 8 * n)) : new BigUint64Array(0);
    const index = new Uint16Array(n), color = new Uint8Array(n), rgba = new Float32Array(4 * n);
    if (n) {
      const uaw = new Uint32Array(ua.buffer);
      for (let i = 0; i < n; i++) index[i] = (uaw[2 * i + 1] >>> 8) & 0xFFF; // (UA >> 40) & 0xFFF
      if (w.nms_inst_count() === n) { // otherwise colours stay unknown, as in the emulator's csv
        const ins = new Float32Array(w.memory.buffer, w.nms_inst(), (n * 0x30) >> 2);
        for (let i = 0; i < n; i++) {
          const k = i * 12 + 8;
          rgba[4 * i] = ins[k]; rgba[4 * i + 1] = ins[k + 1]; rgba[4 * i + 2] = ins[k + 2]; rgba[4 * i + 3] = ins[k + 3];
          color[i] = colorIndex(ins[k], ins[k + 1], ins[k + 2]);
        }
      } else color.fill(5);
    }
    return { gal: gal & 0xFF, x, y, z, seed: regionSeedHex(gal, x, y, z), count: n, positions, ua, index, color, rgba, baseCount: w.nms_base_count() };
  }

  // Radius 1 gives 27 regions, order dy, dz, dx from -1 to 1. Neighbours past a coordinate limit wrap through the masks; whether the game wraps there is not known.
  // dx, dy, dz tell where the region sits: position relative to the centre region = (dx, dy, dz) x 100 + local position. 1 unit = 4 light years.
  function* viewRegions(gal, x, y, z, radius = 1) {
    for (let dy = -radius; dy <= radius; dy++) for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
      yield Object.assign(buildRegion(gal, x + dx, y + dy, z + dz), { dx, dy, dz });
    }
  }
  return { buildRegion, viewRegions, buildView: (g, x, y, z, r) => [...viewRegions(g, x, y, z, r)] };
}

// Worker form. buildView is an async iterator giving each region as soon as it is ready; buildRegion returns a promise. Calls are served one at a time.
export function startStarWorker(workerUrl = new URL("./nms_stars_worker.js", import.meta.url)) {
  const worker = new Worker(workerUrl, { type: "module" });
  let nextId = 1;
  const pending = new Map();
  worker.onmessage = (ev) => {
    const m = ev.data, p = pending.get(m.id);
    if (p) p(m);
  };
  worker.onerror = (ev) => { for (const p of pending.values()) p({ error: ev.message || "worker failed" }); };
  function stream(msg) {
    const id = nextId++, queue = [];
    let wake = null;
    pending.set(id, (m) => { queue.push(m); if (wake) { wake(); wake = null; } });
    worker.postMessage(Object.assign({ id }, msg));
    return (async function* () {
      try {
        for (;;) {
          if (!queue.length) await new Promise((r) => { wake = r; });
          const m = queue.shift();
          if (m.error) throw new Error(m.error);
          if (m.done) return;
          yield m.region;
        }
      } finally { pending.delete(id); }
    })();
  }
  return {
    buildView: (gal, x, y, z, radius = 1) => stream({ op: "view", gal, x, y, z, radius }),
    buildRegion: async (gal, x, y, z) => { for await (const r of stream({ op: "region", gal, x, y, z })) return r; },
    terminate: () => worker.terminate(),
  };
}
