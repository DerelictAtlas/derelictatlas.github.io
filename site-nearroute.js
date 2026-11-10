/* site-nearroute.js (SITE v150, 2026-11-08, user: "navigating to a faraway system ... it would tell the user step by step in a list ... and try to load
 * systems the entire way as illustration"): plan a far trip as a list of hops, one yellow star per jump, and walk it with check-ins. Mockup:
 * near-mockups/3-mobile-navigate.png ("06 Triangulation, Mobile navigation": Plan route, Next jump, After check-in, Direct bearing).
 *
 * Two parts in one file.
 *  1. The planner (pure code, tested in Node by site12/nearroute_test.cjs): planRoute() walks the corridor between start and target, asks io.region()
 *     for each region's star list (the star port, build 7.10), keeps yellow stars with index 1..120 only, and finds the route with the fewest jumps,
 *     then the shortest total length, where every leg is at most the warp range (breadth-first search over stars within range of each other).
 *  2. The window (browser only): a full-window dialog, hop map, summary, next jump with glyphs, check-in, bearing tab, hop list, saved trip.
 *
 * Star positions: a region is 400 ly wide (100 units, 1 unit = 4 ly); a star's place in light years is (region x 100 + local position) x 4. The
 * list of one region holds the indexes 1..n; the index is the system number in the address. Colour 0 = yellow. Index 121 is the black hole mark and
 * 122 the Atlas station in the regions read, 1001 and up are purple extras: none of them is ever a hop. No black hole exits, no jumps through them.
 * Nothing is sent anywhere. One star worker (about 133 MB of wasm memory) is made when a plan starts and ended when the plan is done, stopped or the
 * window closes. Region star lists are cached for the session only (CACHE_MAX regions, oldest dropped first, about 9 KB each).
 *
 * Hook: site-near.js tripHtml puts dvNearRoute.hookHtml(distance, range) in the Heading there top bar (a "Plan route in hops" button, or
 * "In range of one jump"). A click on [data-nrt-open] opens this window. Check-ins made here are also added to the Near me trip. */
(function () {
  "use strict";
  const PARTIAL_LY = 6000, STRETCH_LY = 5000, REG = 400, LYU = 4, MAX_IDX = 120, CAP_REGIONS = 150, CACHE_MAX = 400;
  const LABEL = "Planned from worked-out star positions on game version 7.10. Not yet followed in game. Some stars may need a drive upgrade.";
  const STOP = { stop: true };
  const sq = (v) => v * v;
  const dist3 = (a, b) => Math.sqrt(sq(a[0] - b[0]) + sq(a[1] - b[1]) + sq(a[2] - b[2]));
  const inGalaxy = (x, y, z) => x >= -2048 && x <= 2047 && z >= -2048 && z <= 2047 && y >= -128 && y <= 127;
  const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const rk = (x, y, z) => x + ":" + y + ":" + z;
  const starLy = (r, k) => [(r.x * 100 + r.pos[3 * k]) * LYU, (r.y * 100 + r.pos[3 * k + 1]) * LYU, (r.z * 100 + r.pos[3 * k + 2]) * LYU];

  // ------------------------------------------------------------------------------------------ planner (pure)
  function segT(p, a, b) {   // parameter 0..1 of the point on segment a-b nearest p, and the distance to it
    const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2], L2 = abx * abx + aby * aby + abz * abz;
    let t = L2 ? ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby + (p[2] - a[2]) * abz) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    return { t, d: Math.sqrt(sq(p[0] - a[0] - abx * t) + sq(p[1] - a[1] - aby * t) + sq(p[2] - a[2] - abz * t)) };
  }
  // regions whose cube (400 ly wide, centred on region x 400) lies within radius ly of the segment a-b, in order along the line; null if the search would be huge
  function regionsAlong(a, b, radius) {
    const L = dist3(a, b), steps = Math.max(1, Math.ceil(L / 40));
    const lo = [0, 1, 2].map((i) => Math.floor((Math.min(a[i], b[i]) - radius - 200) / REG)), hi = [0, 1, 2].map((i) => Math.ceil((Math.max(a[i], b[i]) + radius + 200) / REG));
    if ((hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1) * (steps + 1) > 4e7) return null;
    const out = [];
    for (let rx = lo[0]; rx <= hi[0]; rx++) for (let ry = lo[1]; ry <= hi[1]; ry++) for (let rz = lo[2]; rz <= hi[2]; rz++) {
      if (!inGalaxy(rx, ry, rz)) continue;
      const cx = rx * REG, cy = ry * REG, cz = rz * REG;
      let best = Infinity, bt = 0;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps, dx = Math.max(Math.abs(a[0] + (b[0] - a[0]) * t - cx) - 200, 0), dy = Math.max(Math.abs(a[1] + (b[1] - a[1]) * t - cy) - 200, 0), dz = Math.max(Math.abs(a[2] + (b[2] - a[2]) * t - cz) - 200, 0);
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < best) { best = d; bt = t; }
      }
      if (best <= radius) out.push({ x: rx, y: ry, z: rz, t: bt, d: best });
    }
    out.sort((p, q) => p.t - q.t || p.d - q.d || p.x - q.x || p.y - q.y || p.z - q.z);
    return out;
  }
  function makeGrid(X, Y, Z, n, cell) {
    const g = new Map(), K = (cx, cy, cz) => ((cx + 32768) * 65536 + (cy + 32768)) * 65536 + (cz + 32768);
    for (let i = 0; i < n; i++) {
      const k = K(Math.floor(X[i] / cell), Math.floor(Y[i] / cell), Math.floor(Z[i] / cell));
      const l = g.get(k); if (l) l.push(i); else g.set(k, [i]);
    }
    return { g, K, cell };
  }
  // BFS from node s over stars at most R ly apart. Fewest jumps first, then the shortest total length (lengths are compared inside each BFS layer).
  // nodes = { X, Y, Z (Float64Array, ly), n }. Returns { dist, len, prev, reached } and stops after the layer that holds node t (or when nothing new is found).
  async function bfs(nodes, s, t, R, o) {   // t < 0: no goal, search o.maxLayers jumps out
    const { X, Y, Z, n } = nodes, grid = makeGrid(X, Y, Z, n, R), { g, K } = grid, tick = (o && o.tick) || (() => Promise.resolve());
    const dist = new Int32Array(n).fill(-1), len = new Float64Array(n), prev = new Int32Array(n).fill(-1), R2 = R * R;
    dist[s] = 0; let layer = [s], k = 0, ops = 0;
    const maxL = (o && o.maxLayers) || 1e9;
    while (layer.length && (t < 0 || dist[t] < 0) && k < maxL) {
      const next = [];
      for (const u of layer) {
        const cx = Math.floor(X[u] / R), cy = Math.floor(Y[u] / R), cz = Math.floor(Z[u] / R);
        for (let ax = -1; ax <= 1; ax++) for (let ay = -1; ay <= 1; ay++) for (let az = -1; az <= 1; az++) {
          const l = g.get(K(cx + ax, cy + ay, cz + az)); if (!l) continue;
          ops += l.length;
          for (let q = 0; q < l.length; q++) {
            const v = l[q]; if (v === u) continue;
            const d2 = sq(X[u] - X[v]) + sq(Y[u] - Y[v]) + sq(Z[u] - Z[v]); if (d2 > R2) continue;
            const d = Math.sqrt(d2);
            if (dist[v] < 0) { dist[v] = k + 1; len[v] = len[u] + d; prev[v] = u; next.push(v); }
            else if (dist[v] === k + 1 && len[u] + d < len[v] - 1e-9) { len[v] = len[u] + d; prev[v] = u; }
          }
        }
        if (ops > 40000) { ops = 0; await tick(); if (o && o.stopped && o.stopped()) throw STOP; }
      }
      layer = next; k++;
    }
    return { dist, len, prev };
  }
  // nodes[0] = start, nodes[1] = target. Returns { ok, path (node indexes from start to target), total } or { ok:false, closest (node), reached }.
  async function planHops(nodes, R, o) {
    const r = await bfs(nodes, 0, 1, R, o);
    if (r.dist[1] >= 0) {
      const path = []; for (let v = 1; v >= 0; v = r.prev[v]) path.push(v); path.reverse();
      return { ok: true, path, total: r.len[1] };
    }
    let best = 0, bd = Infinity;
    for (let i = 0; i < nodes.n; i++) if (r.dist[i] >= 0) { const d = Math.sqrt(sq(nodes.X[i] - nodes.X[1]) + sq(nodes.Y[i] - nodes.Y[1]) + sq(nodes.Z[i] - nodes.Z[1])); if (d < bd) { bd = d; best = i; } }
    const path = []; for (let v = best; v >= 0; v = r.prev[v]) path.push(v); path.reverse();
    return { ok: false, closest: best, closestLeft: bd, path };
  }
  // the smallest range (to the next 10 ly) that connects start and target through the stars searched, by halving between R and the direct distance
  async function neededRange(nodes, R, o) {
    let lo = R, hi = Math.ceil(Math.sqrt(sq(nodes.X[0] - nodes.X[1]) + sq(nodes.Y[0] - nodes.Y[1]) + sq(nodes.Z[0] - nodes.Z[1])));
    for (let i = 0; i < 16 && hi - lo > 1; i++) {
      const mid = Math.floor((lo + hi) / 2), r = await bfs(nodes, 0, 1, mid, o);
      if (r.dist[1] >= 0) hi = mid; else lo = mid;
    }
    return Math.ceil(hi / 10) * 10;
  }
  function findSys(r, sys) { if (r) for (let k = 0; k < r.n; k++) if (r.idx[k] === sys) return { ly: starLy(r, k), col: r.col[k] }; return null; }

  // io = { region(x,y,z) -> {x,y,z,n,idx,pos,col} (rejects when it cannot be worked out), progress(info), stopped(), tick() }
  // req = { gal, R, cap, start: {x,y,z,sys}, target: {x,y,z,sys} }  (x,y,z signed region numbers)
  async function planRoute(req, io) {
    const R = req.R, cap = req.cap || CAP_REGIONS, loaded = new Map(), loadMs = [], stat = { failed: 0, failedList: [] }, t0 = nowMs();
    const check = () => { if (io.stopped && io.stopped()) throw STOP; };
    async function load(r, info) {
      const key = rk(r.x, r.y, r.z);
      if (loaded.has(key)) return loaded.get(key);
      check();
      const t = nowMs(); let c = null;
      try { c = await io.region(r.x, r.y, r.z); } catch (e) { if (e === STOP || (e && e.stop)) throw STOP; stat.failed++; stat.failedList.push(key); c = null; }
      loadMs.push(nowMs() - t); loaded.set(key, c);
      return c;
    }
    const sc = await load(req.start), tc = await load(req.target);
    let sStar = findSys(sc, req.start.sys); const tStar = findSys(tc, req.target.sys);
    // v164: a start that is not in the star list of a real region does not block the route: it starts from the middle of that region (up to about 350 ly off)
    if (!sStar && sc && sc.n > 0 && !req.noApprox) { sStar = { ly: [req.start.x * 100 * LYU, req.start.y * 100 * LYU, req.start.z * 100 * LYU], col: 0, approx: true }; if (io.approx) io.approx(sc.n); }
    if (!sStar) return { ok: false, error: "start-unknown" };
    if (!tStar) return { ok: false, error: "target-unknown" };
    const a = sStar.ly, b = tStar.ly, d = dist3(a, b), LB = Math.max(1, Math.ceil(d / R - 1e-9));
    if (io.ends) io.ends(a, b);
    if (d <= R) {
      const hop = { x: req.target.x, y: req.target.y, z: req.target.z, sys: req.target.sys, ly: b, leg: d, left: 0, col: tStar.col };
      return { ok: true, single: true, hops: [hop], total: d, direct: d, lb: LB, regions: loaded.size, failed: stat.failed, tiers: [], loadMs };
    }
    const rmax = Math.max(R * 0.5, 200), r1 = Math.min(300, rmax);
    const fit = (maxR) => { for (let r = maxR; r >= 120; r *= 0.8) { const l = regionsAlong(a, b, r); if (l && l.length <= cap) return { r, list: l }; } return null; };
    // A far target (more than PARTIAL_LY away, or a strip that needs more than the region cap): plan only the first stretch toward it. The stretch is about
    // STRETCH_LY long (shortened until its strip fits the cap); K = the jumps that stretch needs; the stop is the star within K jumps with the least distance left.
    const partial = async () => {
      const e = [(b[0] - a[0]) / d, (b[1] - a[1]) / d, (b[2] - a[2]) / d];
      let S = Math.min(d, STRETCH_LY), tier = null, W = null;
      for (; S >= R && !tier; S *= 0.8) {
        W = [a[0] + e[0] * S, a[1] + e[1] * S, a[2] + e[2] * S];
        for (let r = r1; r >= 120; r *= 0.8) { const l = regionsAlong(a, W, r); if (l && l.length <= cap) { tier = { r, list: l }; break; } }
      }
      if (!tier) return { ok: false, error: "too-many", needed: null, cap, direct: d };
      S /= 0.8;
      if (io.ends) io.ends(a, b, W);
      const K = Math.max(1, Math.ceil(S / R - 1e-9)), { r, list } = tier;
      for (let i = 0; i < list.length; i++) {
        const c = await load(list[i]);
        const cands = [];
        if (c) for (let k = 0; k < c.n; k++) if (c.col[k] === 0 && c.idx[k] >= 1 && c.idx[k] <= MAX_IDX && c.idx[k] <= c.n) { const p = starLy(c, k); if (segT(p, a, W).d <= r) cands.push(p[0], p[1], p[2]); }
        if (io.progress) io.progress({ i: i + 1, total: list.length, tier: "corridor", radius: r, region: list[i], cands, ok: !!c, ms: loadMs[loadMs.length - 1] });
        if (i % 4 === 3 && io.tick) await io.tick();
        check();
      }
      const X = [a[0]], Y = [a[1]], Z = [a[2]], meta = [{ x: req.start.x, y: req.start.y, z: req.start.z, sys: req.start.sys, col: sStar.col }];
      for (const rg of list) {
        const c = loaded.get(rk(rg.x, rg.y, rg.z)); if (!c) continue;
        for (let k = 0; k < c.n; k++) {
          if (c.col[k] !== 0 || c.idx[k] < 1 || c.idx[k] > MAX_IDX || c.idx[k] > c.n) continue;
          if (rg.x === req.start.x && rg.y === req.start.y && rg.z === req.start.z && c.idx[k] === req.start.sys) continue;
          const p = starLy(c, k); if (segT(p, a, W).d > r) continue;
          X.push(p[0]); Y.push(p[1]); Z.push(p[2]); meta.push({ x: rg.x, y: rg.y, z: rg.z, sys: c.idx[k], col: 0 });
        }
      }
      const nodes = { X: Float64Array.from(X), Y: Float64Array.from(Y), Z: Float64Array.from(Z), n: X.length };
      const tp = nowMs(), g = await bfs(nodes, 0, -1, R, Object.assign({ maxLayers: K }, io)), ms = nowMs() - tp;
      let bi = -1, bl = Infinity;
      for (let i = 1; i < nodes.n; i++) {
        if (g.dist[i] < 0) continue;
        const left = Math.sqrt(sq(nodes.X[i] - b[0]) + sq(nodes.Y[i] - b[1]) + sq(nodes.Z[i] - b[2]));
        if (left < bl - 1e-9 || (Math.abs(left - bl) <= 1e-9 && (g.dist[i] < g.dist[bi] || (g.dist[i] === g.dist[bi] && g.len[i] < g.len[bi])))) { bl = left; bi = i; }
      }
      const base = { direct: d, lb: LB, regions: loaded.size, failed: stat.failed, tiers: [{ radius: r, regions: list.length, nodes: nodes.n, hops: bi < 0 ? null : g.dist[bi], planMs: ms }], loadMs, ms: nowMs() - t0, partial: true, stretch: S, k: K };
      if (bi < 0 || bl >= d - 1e-6) return Object.assign(base, { ok: false, error: "no-stars", direct: d });
      const path = []; for (let v = bi; v >= 0; v = g.prev[v]) path.push(v); path.reverse();
      const hops = [];
      for (let q = 1; q < path.length; q++) {
        const u = path[q - 1], v = path[q], m = meta[v];
        hops.push({ x: m.x, y: m.y, z: m.z, sys: m.sys, ly: [nodes.X[v], nodes.Y[v], nodes.Z[v]], leg: Math.sqrt(sq(nodes.X[u] - nodes.X[v]) + sq(nodes.Y[u] - nodes.Y[v]) + sq(nodes.Z[u] - nodes.Z[v])), left: Math.sqrt(sq(nodes.X[v] - b[0]) + sq(nodes.Y[v] - b[1]) + sq(nodes.Z[v] - b[2])), col: 0 });
      }
      return Object.assign(base, { ok: true, hops, total: g.len[bi], radius: r, regionsSearched: list.length, leftAfter: bl });
    };
    const tiers = [], first = d > PARTIAL_LY ? null : fit(r1);
    if (!first) return await partial();
    let best = null, lastNodes = null, failedBest = null;
    const plan = async (tier, label) => {
      const { r, list } = tier;
      for (let i = 0; i < list.length; i++) {
        const c = await load(list[i]);
        const cands = [];
        if (c) for (let k = 0; k < c.n; k++) if (c.col[k] === 0 && c.idx[k] >= 1 && c.idx[k] <= MAX_IDX && c.idx[k] <= c.n) { const p = starLy(c, k); if (segT(p, a, b).d <= r) cands.push(p[0], p[1], p[2]); }
        if (io.progress) io.progress({ i: i + 1, total: list.length, tier: label, radius: r, region: list[i], cands, ok: !!c, ms: loadMs[loadMs.length - 1] });
        if (i % 4 === 3 && io.tick) await io.tick();
        check();
      }
      const X = [a[0], b[0]], Y = [a[1], b[1]], Z = [a[2], b[2]], meta = [{ x: req.start.x, y: req.start.y, z: req.start.z, sys: req.start.sys, col: sStar.col }, { x: req.target.x, y: req.target.y, z: req.target.z, sys: req.target.sys, col: tStar.col }];
      for (const rg of list) {
        const c = loaded.get(rk(rg.x, rg.y, rg.z)); if (!c) continue;
        for (let k = 0; k < c.n; k++) {
          if (c.col[k] !== 0 || c.idx[k] < 1 || c.idx[k] > MAX_IDX || c.idx[k] > c.n) continue;
          if (rg.x === req.start.x && rg.y === req.start.y && rg.z === req.start.z && c.idx[k] === req.start.sys) continue;
          if (rg.x === req.target.x && rg.y === req.target.y && rg.z === req.target.z && c.idx[k] === req.target.sys) continue;
          const p = starLy(c, k); if (segT(p, a, b).d > r) continue;
          X.push(p[0]); Y.push(p[1]); Z.push(p[2]); meta.push({ x: rg.x, y: rg.y, z: rg.z, sys: c.idx[k], col: 0 });
        }
      }
      const nodes = { X: Float64Array.from(X), Y: Float64Array.from(Y), Z: Float64Array.from(Z), n: X.length };
      const tp = nowMs(), res = await planHops(nodes, R, io), ms = nowMs() - tp;
      tiers.push({ radius: r, regions: list.length, nodes: nodes.n, hops: res.ok ? res.path.length - 1 : null, planMs: ms });
      lastNodes = nodes;
      if (res.ok) {
        const hops = []; let left = d;
        for (let q = 1; q < res.path.length; q++) {
          const u = res.path[q - 1], v = res.path[q], leg = Math.sqrt(sq(nodes.X[u] - nodes.X[v]) + sq(nodes.Y[u] - nodes.Y[v]) + sq(nodes.Z[u] - nodes.Z[v]));
          const m = meta[v]; hops.push({ x: m.x, y: m.y, z: m.z, sys: m.sys, ly: [nodes.X[v], nodes.Y[v], nodes.Z[v]], leg, left: Math.sqrt(sq(nodes.X[v] - b[0]) + sq(nodes.Y[v] - b[1]) + sq(nodes.Z[v] - b[2])), col: m.col });
        }
        const cand = { ok: true, hops, total: res.total, direct: d, lb: LB, radius: r, regionsSearched: list.length };
        if (!best || hops.length < best.hops.length || (hops.length === best.hops.length && res.total < best.total)) best = cand;
      } else {
        const m = meta[res.closest];
        failedBest = { x: m.x, y: m.y, z: m.z, sys: m.sys, ly: [nodes.X[res.closest], nodes.Y[res.closest], nodes.Z[res.closest]], left: res.closestLeft, jumps: res.path.length - 1 };
      }
    };
    await plan(first, "corridor");
    if (!best || best.hops.length > LB) {
      const wide = fit(rmax);
      if (wide && wide.r > first.r * 1.2) await plan(wide, "wider");
    }
    const base = { direct: d, lb: LB, regions: loaded.size, failed: stat.failed, tiers, loadMs, ms: nowMs() - t0 };
    if (best) return Object.assign(base, best);
    const needed = await neededRange(lastNodes, R, io);
    return Object.assign(base, { ok: false, error: "no-route", closest: failedBest, needed });
  }
  const pure = { PARTIAL_LY, STRETCH_LY, planRoute, planHops, regionsAlong, neededRange, bfs, segT, starLy, findSys, LABEL, MAX_IDX, CAP_REGIONS };
  if (typeof document === "undefined") { if (typeof module !== "undefined") module.exports = pure; return; }
  if (globalThis.dvNearRoute) return;

  // ------------------------------------------------------------------------------------------ star port (browser)
  const SCRIPT = document.currentScript && document.currentScript.src;
  const BASE = new URL("stars/", SCRIPT || location.href).href;
  const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
  const soft = (m) => Object.assign(new Error(m), { soft: true });
  const W = { api: null, worker: null, loads: 0, cache: new Map(), stopRej: null, stopP: null, gal: 0 };
  async function getApi() {
    if (W.api) return W.api;
    if (!globalThis.WebAssembly) throw soft("This browser has no WebAssembly.");
    if (!globalThis.Worker) throw soft("This browser cannot run the background worker.");
    if (!/^https?:$/.test(location.protocol)) throw soft("The star files need the page to be opened from a web address.");
    let simd = false; try { simd = WebAssembly.validate(SIMD_PROBE); } catch (_) { simd = false; }
    if (!simd) throw soft("This browser has no WebAssembly SIMD.");
    try { W.api = await import(BASE + "nms_stars.js"); } catch (_) { throw soft("The star files did not load."); }
    return W.api;
  }
  function killWorker() { if (W.worker) { try { W.worker.terminate(); } catch (_) { /* gone already */ } W.worker = null; } }
  async function loadRegion(x, y, z) {
    const key = W.gal + ":" + rk(x, y, z), hit = W.cache.get(key);
    if (hit) return hit;
    const api = await getApi();
    if (!W.worker) { try { W.worker = api.startStarWorker(new URL("nms_stars_worker.js", BASE)); W.loads++; } catch (_) { throw soft("The background worker did not start."); } }
    let timer;
    const guard = new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error("timeout"), { timeout: true })), 20000); });
    let r;
    try { r = await Promise.race([W.worker.buildRegion(W.gal, x, y, z), guard, W.stopP]); }
    catch (e) { killWorker(); throw e; }
    finally { clearTimeout(timer); }
    if (!(r.count >= 0 && r.count < 4000)) throw new Error("implausible star count");
    const c = { x, y, z, n: r.count, idx: r.index, pos: r.positions, col: r.color };
    W.cache.set(key, c);
    if (W.cache.size > CACHE_MAX) for (const k of [...W.cache.keys()].slice(0, W.cache.size - CACHE_MAX)) W.cache.delete(k);
    return c;
  }

  // ------------------------------------------------------------------------------------------ small helpers
  const KEY = "dv.nearroute.v1";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (n) => Math.round(n).toLocaleString("en-US");
  const hex = (n, w) => (n >>> 0).toString(16).toUpperCase().padStart(w, "0");
  const N = () => (globalThis.dvNear ? globalThis.dvNear : null);
  const addrOf = (sys, gal, x, y, z) => "000" + hex(sys, 3) + hex(gal, 2) + hex(y & 255, 2) + hex(z & 4095, 3) + hex(x & 4095, 3);
  const signed = (v, bits) => (v >= (1 << (bits - 1)) ? v - (1 << bits) : v);
  function coordsOf(a) { const lo = parseInt(a.slice(8), 16) >>> 0; return { x: signed(lo & 0xfff, 12), z: signed((lo >>> 12) & 0xfff, 12), y: signed(lo >>> 24, 8), sys: parseInt(a.slice(3, 6), 16), gal: parseInt(a.slice(6, 8), 16) }; }
  const glyphsOf = (a) => "0" + a.slice(3, 6) + a.slice(8);
  const sysName = (a) => { try { return (globalThis.dvSystemName && dvSystemName(a)) || ""; } catch (_) { return ""; } };
  const nameOf = (a) => sysName(a) || "System " + hex(coordsOf(a).sys, 3);
  const galName = (g) => (globalThis.dvGalaxy ? dvGalaxy.label(g) : g === 0 ? "Euclid" : "Galaxy " + (g + 1));
  const samePlace = (p, q) => p.sys === q.sys && p.x === q.x && p.y === q.y && p.z === q.z;
  const isTouch = () => { try { return matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0; } catch (_) { return false; } };
  const ICON = '<svg class="nrt-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6.5"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/></svg>';
  // The one place for the wording about our mod (SITE v164). It is in development: change this text only when the mod is released.
  const MOD_TEXT = "Our mod is a navigator and route planner, and also a minimap for derelicts shown as an overlay in the game. It is in development and not released yet.";
  globalThis.dvModText = MOD_TEXT;
  const modNote = () => `<p class="nrt-note nrt-mod" id="nrt-mod">${esc(MOD_TEXT)}</p>`;
  const jset = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (_) { /* private mode */ } };
  const jget = () => { try { const j = JSON.parse(localStorage.getItem(KEY)); return j && j.v === 1 ? j : null; } catch (_) { return null; } };
  const tick = () => new Promise((r) => setTimeout(r, 0));

  // ------------------------------------------------------------------------------------------ state
  // T = the trip: { v:1, gal, target:{address}, start:{address}, range, hops:[{address,name,leg,left,ly,col}], total, direct, lb, done, started }
  let dlg = null, T = null, runId = 0, planning = false;
  const ui = { view: null, screen: "plan", tab: "hops", ci: false, msg: "", msgBad: false, off: null, load: null, fail: null, stars: [], tier: "", info: null, err: "" };
  const gKey = (p) => p.x + "," + p.y + "," + p.z;

  function sample(a, max) { const n = a.length / 3, step = Math.max(1, Math.ceil(n / max)), o = []; for (let i = 0; i < n; i += step) o.push(Math.round(a[3 * i]), Math.round(a[3 * i + 1]), Math.round(a[3 * i + 2])); return o; }
  function stopPlan(why) {
    runId++; planning = false;
    if (W.stopRej) { const r = W.stopRej; W.stopRej = null; try { r(STOP); } catch (_) { /* nothing waits */ } }
    killWorker();
    if (why) ui.err = why;
  }
  async function startPlan(startAddr, targetAddr, gal, range, keepNote, parts) {
    stopPlan();
    const my = ++runId; planning = true; W.gal = gal;
    const sc = coordsOf(startAddr), tc = coordsOf(targetAddr);
    T = { v: 1, gal, target: { address: targetAddr }, start: { address: startAddr }, range, hops: [], total: 0, direct: 0, lb: 0, done: 0, started: false, parts: parts || [] };
    Object.assign(ui, { view: null, screen: "load", ci: false, msg: keepNote || "", msgBad: false, off: null, load: { i: 0, total: 0, tier: "", n: 0, ms: 0 }, fail: null, stars: [], info: null, err: "" });
    W.stopP = new Promise((_, rej) => { W.stopRej = rej; }); W.stopP.catch(() => {});
    if (globalThis.dvNearMap && dvNearMap.stop) { try { dvNearMap.stop(); } catch (_) { /* the Near me map is not needed now */ } }
    ui.base = null; paint();
    const io = {
      region: loadRegion, tick, stopped: () => my !== runId,
      approx: (n) => { if (my === runId) { T.startApprox = true; T.startN = n; } },
      ends: (a, b, w) => { if (my === runId) { T.startLy = a; T.targetLy = b; T.mapEnd = w || null; paint(); drawSoon(); } },
      progress: (p) => {
        if (my !== runId) return;
        ui.load.i = p.i; ui.load.total = p.total; ui.load.tier = p.tier; ui.load.n++; ui.load.ms += p.ms || 0; ui.tier = p.tier;
        for (let q = 0; q < p.cands.length; q += 3) ui.stars.push(p.cands[q], p.cands[q + 1], p.cands[q + 2]);
        paintLoad(); drawSoon();
      },
    };
    let res;
    try { res = await planRoute({ gal, R: range, start: { x: sc.x, y: sc.y, z: sc.z, sys: sc.sys }, target: { x: tc.x, y: tc.y, z: tc.z, sys: tc.sys } }, io); }
    catch (e) {
      if (my !== runId) return;
      planning = false; killWorker();
      if (e === STOP || (e && e.stop)) { ui.screen = "stopped"; } else { ui.screen = "fail"; ui.fail = { kind: "error", text: e && e.soft ? e.message : "The star positions could not be worked out here. " + String((e && e.message) || e) }; }
      paint(); return;
    }
    if (my !== runId) return;
    planning = false; killWorker();   // the worker holds about 133 MB: it is not needed to walk the route
    ui.info = { regions: res.regions, failed: res.failed, tiers: res.tiers, loadMs: res.loadMs, ms: res.ms, lb: res.lb, radius: res.radius };
    if (!res.ok) {
      ui.screen = "fail"; ui.fail = Object.assign({ kind: res.error }, res);
      if (res.error === "start-unknown" && N() && N().sysReason) { try { ui.fail.reason = (await N().sysReason(gal, sc.x, sc.y, sc.z, sc.sys)).text; } catch (_) { /* plain text */ } }
      if (my !== runId) return;
      paint(); return;
    }
    if (T.startApprox && N() && N().sysReason) { try { const rs = await N().sysReason(gal, sc.x, sc.y, sc.z, sc.sys); T.startReason = rs.text; } catch (_) { /* plain text */ } if (my !== runId) return; }
    T.hops = res.hops.map((h) => { const a = addrOf(h.sys, gal, h.x, h.y, h.z); return { address: a, name: nameOf(a), leg: h.leg, left: h.left, ly: h.ly, col: h.col }; });
    T.partial = !!res.partial; T.leftAfter = res.leftAfter || 0; T.mapEnd = res.partial ? res.hops[res.hops.length - 1].ly : null;
    T.total = res.total; T.direct = res.direct; T.lb = res.lb; T.single = !!res.single; T.searched = res.regionsSearched; T.radius = res.radius;
    T.startLy = T.startLy || null; T.stars = sample(ui.stars, 500);
    ui.screen = "plan"; jset(T); paint();
  }

  // ------------------------------------------------------------------------------------------ parts (v164)
  // A far trip is planned in parts. T is always the newest part; T.parts holds the earlier ones (read only snapshots), so every part stays viewable.
  const partsN = () => (T && T.parts ? T.parts.length : 0);
  function snapPart(t) {
    return { hops: t.hops, total: t.total, direct: t.direct, lb: t.lb, single: t.single, searched: t.searched, radius: t.radius, range: t.range, leftAfter: t.leftAfter, partial: t.partial, start: t.start, startLy: t.startLy, mapEnd: t.mapEnd, stars: (t.stars || []).slice(0, 600), done: t.hops.length };
  }
  function viewT() { return ui.view != null && T && T.parts && T.parts[ui.view] ? Object.assign({}, T, T.parts[ui.view], { parts: T.parts }) : null; }
  const curPart = () => (viewT() ? ui.view : partsN());
  function goPart(k) {
    const n = partsN(); k = Math.max(0, Math.min(n, k));
    ui.view = k >= n ? null : k; ui.tab = "hops"; ui.ci = false; paint(); drawSoon();
  }
  function partBar() {
    const n = partsN(); if (!n || ui.screen === "load" || ui.screen === "fail" || ui.screen === "stopped") return "";
    const c = curPart();
    return `<div class="nrt-parts" role="group" aria-label="Route parts"><b class="nrt-partlbl" id="nrt-partlbl">Part ${c + 1} of ${n + 1}</b><span class="nrt-partbtns"><button type="button" class="nrt-mini" data-nrt-part="first"${c === 0 ? " disabled" : ""}>First part</button><button type="button" class="nrt-mini" data-nrt-part="prev"${c === 0 ? " disabled" : ""}>Previous part</button><button type="button" class="nrt-mini" data-nrt-part="next"${c === n ? " disabled" : ""}>Next part</button></span></div>`;
  }
  function viewHtml() {   // an earlier part, read only (T is the part itself while this runs)
    const M = T.hops.length, left = T.targetLy ? dist3(T.hops[M - 1].ly, T.targetLy) : null;
    return `<div class="nrt-panel"><b class="nrt-big">Part ${ui.view + 1}: ${M} jump${M === 1 ? "" : "s"}, ${num(T.total)} ly route</b><span class="nrt-note">An earlier part of your route. You checked in at its last stop${left == null ? "" : ", " + num(left) + " ly from the target"}. Use Next part to go on.</span></div>
<p class="nrt-label">${LABEL}</p><div class="nrt-listbox">${listHtml()}</div>${modNote()}`;
  }

  // ------------------------------------------------------------------------------------------ the map
  let cv = null, ctx = null, raf = 0, DPR = 1, CW = 0, CH = 0;
  function basis() {
    const A = T && T.start && T.startLy, B = T && (T.mapEnd || T.targetLy);
    if (!A || !B) return null;
    const d = dist3(A, B) || 1, e1 = [(B[0] - A[0]) / d, (B[1] - A[1]) / d, (B[2] - A[2]) / d];
    let up = [0, 1, 0]; if (Math.abs(e1[1]) > 0.98) up = [1, 0, 0];
    const k = up[0] * e1[0] + up[1] * e1[1] + up[2] * e1[2];
    let e2 = [up[0] - k * e1[0], up[1] - k * e1[1], up[2] - k * e1[2]]; const l = Math.hypot(...e2) || 1; e2 = e2.map((v) => v / l);
    return { A, B, d, e1, e2 };
  }
  function drawSoon() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); }
  function resize() {
    if (!cv) return;
    const box = cv.parentElement, r = box.getBoundingClientRect();
    DPR = Math.min(2, globalThis.devicePixelRatio || 1); CW = Math.max(1, Math.round(r.width)); CH = Math.max(1, Math.round(r.height));
    cv.width = Math.round(CW * DPR); cv.height = Math.round(CH * DPR); cv.style.width = CW + "px"; cv.style.height = CH + "px";
    drawSoon();
  }
  function draw() {   // an earlier part is drawn from its own snapshot
    const vt = viewT(); if (!vt) return draw0();
    const real = T, st = ui.stars; T = vt; ui.stars = vt.stars || [];
    try { draw0(); } finally { T = real; ui.stars = st; }
  }
  function draw0() {
    if (!ctx || !dlg || !dlg.open) return;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const g = ctx.createLinearGradient(0, 0, 0, CH); g.addColorStop(0, "#07131d"); g.addColorStop(1, "#050d15");
    ctx.fillStyle = g; ctx.fillRect(0, 0, CW, CH);
    const B = basis(); if (!B) return;
    const small = CW < 380 || CH < 260, padL = small ? 30 : 44, padR = small ? 40 : 70, padT = small ? 32 : 40, padB = small ? 30 : 40;
    const iw = Math.max(40, CW - padL - padR), ih = Math.max(40, CH - padT - padB), phi = Math.atan2(ih, iw), cs = Math.cos(phi), sn = Math.sin(phi), sc = Math.hypot(iw, ih) / B.d;
    const x0 = padL, y0 = CH - padB;
    const P = (p) => {
      const dx = p[0] - B.A[0], dy = p[1] - B.A[1], dz = p[2] - B.A[2];
      const u = dx * B.e1[0] + dy * B.e1[1] + dz * B.e1[2], v = dx * B.e2[0] + dy * B.e2[1] + dz * B.e2[2];
      return [x0 + sc * (u * cs + v * sn), y0 + sc * (-u * sn + v * cs)];
    };
    // stars as they load
    ctx.fillStyle = "rgba(235,245,250,.75)";
    for (let q = 0; q < ui.stars.length; q += 3) { const s = P([ui.stars[q], ui.stars[q + 1], ui.stars[q + 2]]); if (s[0] < -4 || s[1] < -4 || s[0] > CW + 4 || s[1] > CH + 4) continue; ctx.beginPath(); ctx.arc(s[0], s[1], 1.25, 0, 6.2832); ctx.fill(); }
    const S0 = P(B.A), T0 = P(B.B), fs = small ? 11 : 13;
    const hops = T.hops || [], bearing = ui.tab === "bearing", haveRoute = hops.length && ui.screen !== "load" && ui.screen !== "fail" && ui.screen !== "stopped";
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (bearing || !haveRoute) {   // direct line: dashed, with an arrow head in the Bearing tab
      ctx.strokeStyle = bearing ? "#f2b705" : "rgba(242,183,5,.35)"; ctx.lineWidth = bearing ? 2 : 1.2; ctx.setLineDash([7, 6]);
      ctx.beginPath(); ctx.moveTo(S0[0], S0[1]); ctx.lineTo(T0[0], T0[1]); ctx.stroke(); ctx.setLineDash([]);
      if (bearing) { const ang = Math.atan2(T0[1] - S0[1], T0[0] - S0[0]), ax = T0[0] - 13 * Math.cos(ang), ay = T0[1] - 13 * Math.sin(ang); ctx.fillStyle = "#f2b705"; ctx.beginPath(); ctx.moveTo(ax + 9 * Math.cos(ang), ay + 9 * Math.sin(ang)); ctx.lineTo(ax - 5 * Math.sin(ang), ay + 5 * Math.cos(ang)); ctx.lineTo(ax + 5 * Math.sin(ang), ay - 5 * Math.cos(ang)); ctx.closePath(); ctx.fill(); }
    }
    const rad = small ? 10 : 12;
    if (haveRoute && !bearing) {
      const pts = [S0].concat(hops.map((h) => P(h.ly))), cur = T.done;
      for (let i = 1; i < pts.length; i++) {
        const done = i <= cur, now = i === cur + 1;
        ctx.strokeStyle = done ? "#4f6a78" : "#29d3ea"; ctx.lineWidth = now ? 3 : 2; ctx.globalAlpha = done || now ? 1 : 0.8;
        if (now) { ctx.shadowColor = "#29d3ea"; ctx.shadowBlur = 8; }
        ctx.beginPath(); ctx.moveTo(pts[i - 1][0], pts[i - 1][1]); ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke(); ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      }
      ctx.font = "600 " + (fs - 1) + "px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      for (let i = 1; i < pts.length; i++) {
        const done = i <= cur, now = i === cur + 1 && ui.screen === "run", last = i === pts.length - 1;
        ctx.fillStyle = "#06131d"; ctx.beginPath(); ctx.arc(pts[i][0], pts[i][1], rad, 0, 6.2832); ctx.fill();
        ctx.lineWidth = now ? 3 : 2; ctx.strokeStyle = done ? "#6b8794" : now ? "#29d3ea" : "#f2b705";
        if (now) { ctx.shadowColor = "#29d3ea"; ctx.shadowBlur = 12; }
        ctx.beginPath(); ctx.arc(pts[i][0], pts[i][1], rad, 0, 6.2832); ctx.stroke(); ctx.shadowBlur = 0;
        ctx.fillStyle = done ? "#8fa9b8" : "#fff"; ctx.fillText(String(i), pts[i][0], pts[i][1] + 0.5);
        if (last) { ctx.lineWidth = 1.2; ctx.strokeStyle = "#f2b70588"; ctx.beginPath(); ctx.arc(pts[i][0], pts[i][1], rad + 4, 0, 6.2832); ctx.stroke(); }
      }
    } else {
      ctx.lineWidth = 2; ctx.strokeStyle = "#f2b705"; ctx.fillStyle = "#06131d"; ctx.beginPath(); ctx.arc(T0[0], T0[1], rad, 0, 6.2832); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#f2b705"; ctx.beginPath(); ctx.arc(T0[0], T0[1], 3, 0, 6.2832); ctx.fill();
    }
    // labels
    ctx.font = "600 " + (fs + 1) + "px system-ui, sans-serif"; ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#f2b705"; ctx.textAlign = "right"; ctx.fillText((T.mapEnd ? "Toward " : "") + nameOf(T.target.address), Math.min(CW - 6, T0[0] + rad + 4), Math.max(fs + 4, T0[1] - rad - 8));
    ctx.strokeStyle = "#29d3ea"; ctx.fillStyle = "#29d3ea"; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(S0[0], S0[1], 7, 0, 6.2832); ctx.moveTo(S0[0] - 11, S0[1]); ctx.lineTo(S0[0] - 4, S0[1]); ctx.moveTo(S0[0] + 4, S0[1]); ctx.lineTo(S0[0] + 11, S0[1]); ctx.moveTo(S0[0], S0[1] - 11); ctx.lineTo(S0[0], S0[1] - 4); ctx.moveTo(S0[0], S0[1] + 4); ctx.lineTo(S0[0], S0[1] + 11); ctx.stroke();
    ctx.textAlign = "left"; ctx.fillText(T.startApprox ? "You (about here)" : "You", Math.max(4, S0[0] - 14), Math.min(CH - 6, S0[1] + 26));
    if (ui.screen === "run" && T.done < hops.length && !bearing) {   // name of the next stop beside it
      const h = hops[T.done], p = P(h.ly); ctx.font = "500 " + (fs - 1) + "px system-ui, sans-serif"; ctx.fillStyle = "#bfe9f1"; ctx.textAlign = p[0] > CW * 0.62 ? "right" : "left";
      ctx.fillText(nameOf(h.address), p[0] + (p[0] > CW * 0.62 ? -rad - 5 : rad + 5), p[1] + rad + 13);
    }
  }

  // ------------------------------------------------------------------------------------------ the window
  function build() {
    if (dlg || !document.body) return;
    dlg = document.createElement("dialog");
    dlg.id = "nrt-dialog"; dlg.className = "nrt"; dlg.setAttribute("aria-labelledby", "nrt-title");
    dlg.innerHTML = `<div class="nrt-top"><button type="button" class="nrt-x nrt-back" data-nrt-close aria-label="Back to Heading there">&larr;</button><h2 id="nrt-title">Navigate</h2><span class="nrt-sub">Route in hops</span><span class="nrt-hatch" aria-hidden="true"></span><button type="button" class="nrt-x" data-nrt-close aria-label="Close">&times;</button></div>
<div class="nrt-body"><section class="nrt-main"><div class="nrt-tcard" id="nrt-tcard"></div><div class="nrt-tabs" role="tablist" aria-label="Route view"><button type="button" role="tab" data-nrt-tab="hops" id="nrt-t-hops">Hops</button><button type="button" role="tab" data-nrt-tab="bearing" id="nrt-t-bearing">Bearing</button></div>
<div class="nrt-mapbox"><canvas id="nrt-cv" role="img" aria-label="Route map. You are at the lower left, the target at the upper right."></canvas><p class="nrt-mapnote" id="nrt-mapnote"></p></div></section>
<aside class="nrt-side" id="nrt-side"></aside></div>`;
    document.body.appendChild(dlg);
    cv = $("nrt-cv"); ctx = cv.getContext("2d");
    if (globalThis.ResizeObserver) new ResizeObserver(resize).observe(cv.parentElement);
    window.addEventListener("resize", resize);
    dlg.addEventListener("click", onClick); dlg.addEventListener("input", onInput); dlg.addEventListener("change", onInput);
    dlg.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target && e.target.id === "nrt-ci") { e.preventDefault(); doCheckIn(); } if (e.key === "Enter" && e.target && e.target.id === "nrt-range") { e.preventDefault(); e.target.blur(); } });
    dlg.addEventListener("close", onClose);
  }
  function onClose() {
    stopPlan(); ui.view = null; ui.screen = T && T.hops && T.hops.length ? (T.started ? "run" : "plan") : "plan";
    const d = $("nr-drive");   // hand the drive range and the new position back to Heading there: its own change handler saves and repaints
    if (d && T) { try { if (Number(d.value) !== T.range) d.value = T.range; d.dispatchEvent(new Event("change", { bubbles: true })); } catch (_) { /* the Near me window is not there */ } }
  }
  const tgtLeft = () => {   // straight line from the player's present stop to the target, from star positions
    if (!T || !T.targetLy) return 0;
    const cur = T.done > 0 ? T.hops[T.done - 1].ly : T.startLy;
    return dist3(cur, T.targetLy);
  };
  function glyphRow(addr) { return `<span class="nrt-glyphs" aria-label="Glyphs ${glyphsOf(addr)}">${glyphsOf(addr).split("").map((c) => `<img src="glyphs-svg/${c.toLowerCase()}.svg" alt="">`).join("")}</span>`; }
  function listHtml() {
    if (!T.hops.length) return "";
    return `<ol class="nrt-list" aria-label="All jumps">${T.hops.map((h, i) => `<li class="${i < T.done ? "done" : i === T.done && ui.screen === "run" ? "cur" : ""}"><span class="nrt-n">${i + 1}</span><span class="nrt-nm">${esc(h.name)}</span><span class="nrt-ly">${num(h.leg)} ly</span><code>${glyphsOf(h.address)}</code><button type="button" class="nrt-mini" data-nrt-copy="${i}" aria-label="Copy glyphs for jump ${i + 1}">Copy</button>${T.partial && i === T.hops.length - 1 ? '<span class="nrt-nextnote">Plan the next part from here</span>' : ""}</li>`).join("")}</ol>`;
  }
  const fineHtml = () => `<details class="nrt-how"><summary>How this was planned</summary><ul>
<li>Every jump is a straight line of at most your warp range. Each stop is a yellow star with a system number from 1 to 120, so stops are never a black hole, an Atlas station or a purple star. The route never goes through a black hole.</li>
<li>The fewest jumps are chosen first, then the shortest total length. Only stars in a strip along the straight line between you and the target were searched${T && T.searched ? " (" + T.searched + " regions" + (ui.info && ui.info.failed ? ", " + ui.info.failed + " could not be worked out" : "") + ")" : ""}, so a route outside the strip could use fewer jumps.</li>
<li>Star positions are worked out from the game's code. They were checked against one Euclid and one Galaxy 9 system on game build 7.10 (25 of 25 distances matched). Other galaxies were not checked. Names are generated guesses and a player may have renamed a system.</li>
<li>The map is a flat picture along your route. Heights are squashed, so look at the distances in the list, not the picture.</li></ul></details>`;
  function paint() {
    if (!dlg || !T) return;
    const scr = ui.screen, tab = ui.tab, vt = viewT();
    if (ui.view != null && !vt) ui.view = null;
    dlg.dataset.screen = vt ? "view" : scr; dlg.dataset.tab = tab; dlg.dataset.part = String(curPart());
    $("nrt-t-bearing").disabled = !!vt;
    $("nrt-t-hops").classList.toggle("on", tab === "hops"); $("nrt-t-bearing").classList.toggle("on", tab === "bearing");
    $("nrt-t-hops").setAttribute("aria-selected", tab === "hops"); $("nrt-t-bearing").setAttribute("aria-selected", tab === "bearing");
    const real = T; if (vt) T = vt;
    try { paintMain(vt, scr); } finally { T = real; }
  }
  function paintMain(vt, scr) {
    const tab = ui.tab;
    const tn = nameOf(T.target.address), left = T.targetLy ? tgtLeft() : null;
    $("nrt-tcard").innerHTML = `${ICON}<div><b>${esc(tn)}</b> <i>&middot;</i> <span class="nrt-gal">${esc(galName(T.gal))}</span><small>${left == null ? "" : num(left) + " ly away" + (T.done ? " (from your last stop)" : "")}</small></div>`;
    $("nrt-mapnote").textContent = scr === "load" ? "Yellow stars along the route appear as each region is worked out." : "Yellow stars the route can use. Flat picture along the route.";
    const side = $("nrt-side"); let h = "";
    if (vt) {
      h = viewHtml();
    } else if (scr === "load") {
      h = `<div class="nrt-panel" id="nrt-loadp"><b class="nrt-big" id="nrt-lt"></b><div class="nrt-bar" id="nrt-lbar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span style="width:0%"></span></div><span class="nrt-note" id="nrt-ln"></span><div class="nrt-row"><button type="button" class="nrt-ghost" data-nrt-act="stop">Stop</button></div></div>`;
    } else if (scr === "stopped") {
      h = `<div class="nrt-panel"><b>Stopped.</b><p class="nrt-note">The route needs every region along the line, so nothing was planned. The star worker was ended.</p><div class="nrt-row"><button type="button" class="nrt-gold" data-nrt-act="replan">Plan again</button></div></div>`;
    } else if (scr === "fail") {
      h = failHtml();
    } else if (tab === "bearing") {
      h = `<div class="nrt-panel"><b class="nrt-big">${num(T.directNow || tgtLeft())} ly direct</b><span class="nrt-note">Direction only</span></div>
<div class="nrt-legend"><div class="nrt-legrow"><span class="nrt-l1"></span>Planned route (hops)</div><div class="nrt-legrow"><span class="nrt-l2"></span>Direct bearing (single leg)</div><button type="button" class="nrt-gold nrt-sm" data-nrt-tab="hops">Show hops</button></div>
<p class="nrt-note">${coreLine()}</p><p class="nrt-note">This is the straight line from you to the target.${(T.directNow || tgtLeft()) > T.range ? " The warp range limits each jump, so this single leg is too long to jump in one go." : ""} It is not an exact direction in the game's galaxy map.</p>`;
    } else if (scr === "plan") {
      const M = T.hops.length;
      h = `<div class="nrt-panel">${summaryHtml()}<label class="nrt-range" for="nrt-range">Warp range <input id="nrt-range" type="number" inputmode="numeric" min="50" max="99999" step="50" value="${T.range}" aria-label="Warp range in light years"> ly</label></div>
<p class="nrt-label" id="nrt-label">${LABEL}</p>
<div class="nrt-listbox">${listHtml()}${fineHtml()}</div>${modNote()}
<div class="nrt-row nrt-foot"><button type="button" class="nrt-gold nrt-big-btn" data-nrt-act="start">${ICON}<span>Start route</span></button></div>`;
    } else if (scr === "run") {
      const i = T.done, hp = T.hops[i], M = T.hops.length, nm = hp.name;
      h = `<div class="nrt-panel nrt-jump"><div class="nrt-jh">Jump ${i + 1} of ${M}</div><div class="nrt-jl"><b class="nrt-big">${esc(nm)} <i>&middot;</i> ${num(hp.leg)} ly</b><span class="nrt-toDest"><b>${num(tgtLeft())} ly</b> to destination</span></div>
<div class="nrt-grow">${glyphRow(hp.address)}<button type="button" class="nrt-mini nrt-copy" data-nrt-copy="${i}">Copy glyphs</button></div><p class="nrt-note">Generated name, a best guess. Glyphs: <code>${glyphsOf(hp.address)}</code></p></div>
<p class="nrt-msg ${ui.msgBad ? "bad" : ""}" id="nrt-msg" role="status">${ui.msg}</p>${ui.off ? offHtml() : ""}
${ui.ci ? ciHtml() : ""}
<div class="nrt-listbox">${listHtml()}<p class="nrt-label">${LABEL}</p>${fineHtml()}</div>${modNote()}
<div class="nrt-row nrt-foot">${ui.ci ? `<button type="button" class="nrt-ghost" data-nrt-act="ci-cancel">Cancel</button><button type="button" class="nrt-gold nrt-big-btn" data-nrt-act="ci-go">${ICON}<span>Check in</span></button>` : `<button type="button" class="nrt-gold nrt-big-btn" data-nrt-act="ci-open">${ICON}<span>Check in</span></button>`}</div>
<div class="nrt-row nrt-sec">${T.partial ? '<button type="button" class="nrt-link" data-nrt-act="next">Plan next part now</button>' : ""}<button type="button" class="nrt-link" data-nrt-act="replan">Plan again from the start</button><button type="button" class="nrt-link" data-nrt-act="clear">Clear route</button></div>`;
    } else if (scr === "done") {
      h = T.partial
        ? `<div class="nrt-panel"><b class="nrt-big">End of ${partsN() ? "part " + (partsN() + 1) : "the first part"}</b><span class="nrt-note">You checked in at the last stop. ${num(tgtLeft())} ly still to go to ${esc(nameOf(T.target.address))}. Plan the next part from here.</span></div><div class="nrt-listbox">${listHtml()}</div><div class="nrt-row nrt-foot"><button type="button" class="nrt-gold nrt-big-btn" data-nrt-act="next">${ICON}<span>Plan next part</span></button></div><div class="nrt-row nrt-sec"><button type="button" class="nrt-link" data-nrt-act="clear">Clear route</button></div>`
        : `<div class="nrt-panel"><b class="nrt-big">Arrived</b><span class="nrt-note">You checked in at the last stop, ${esc(nameOf(T.target.address))}. ${T.hops.length} jump${T.hops.length === 1 ? "" : "s"}, ${num(T.total)} ly planned.</span></div><div class="nrt-listbox">${listHtml()}</div><div class="nrt-row nrt-foot"><button type="button" class="nrt-gold nrt-big-btn" data-nrt-act="clear"><span>Done</span></button></div>`;
    }
    const keep = $("nrt-ci") ? $("nrt-ci").value : "";
    side.innerHTML = partBar() + h;
    if ($("nrt-ci")) { $("nrt-ci").value = keep; syncPad(); }
    if (scr === "load") paintLoad();
    resize();
  }
  function summaryHtml() {
    const M = T.hops.length;
    if (T.partial) {
      const prog = T.direct - T.leftAfter;
      return `<b class="nrt-big">${partsN() ? "Part " + (partsN() + 1) + " of the route" : "First part of the route"}: ${M} jump${M === 1 ? "" : "s"}, ${num(prog)} ly toward the target.</b><span class="nrt-note">${num(T.leftAfter)} ly still to go after the last stop. The target is ${num(T.direct)} ly away, too far to plan in one go. Route length ${num(T.total)} ly.</span>${approxNote()}<button type="button" class="nrt-gold nrt-sm" data-nrt-act="next">Plan next part</button>`;
    }
    return `<b class="nrt-big">${M} jump${M === 1 ? "" : "s"} <i>&middot;</i> ${num(T.total)} ly route</b>${approxNote()}<span class="nrt-note">${T.single ? "The target is within one jump." : "Direct line " + num(T.direct) + " ly."}</span>`;
  }
  // v164: shown when the start system is not in the star list of its region and the route starts from the middle of the region
  function approxNote() {
    if (!T.startApprox || T.parts && ui.view != null) return "";
    return `<span class="nrt-note nrt-approx" id="nrt-approx"><b>Approximate start.</b> ${esc(T.startReason || "Your start system is not in the star list of its region.")} The route starts from the middle of the region, up to about 350 ly off. Check in after the first jump.</span>`;
  }
  function coreLine() {
    const n = N(); if (!n || !T.startLy || !T.targetLy) return "";
    const cur = T.done > 0 ? T.hops[T.done - 1].ly : T.startLy, cs = Math.hypot(...cur), ct = Math.hypot(...T.targetLy), diff = cs - ct;
    return `The target is <b>${diff > 0 ? "toward" : "away from"}</b> the galaxy core from you (${num(Math.abs(diff))} ly ${diff > 0 ? "nearer" : "farther"}; you are ${num(cs)} ly from the core).`;
  }
  // the Stop button is made once (in paint) and only the numbers change here, so a click on Stop is never lost to a repaint
  function paintLoad() {
    const t = $("nrt-lt"); if (!t) return;
    const L = ui.load, pct = L.total ? Math.round((L.i * 100) / L.total) : 0, avg = L.n ? Math.round(L.ms / L.n) : 0;
    t.textContent = L.total ? "Loading region " + L.i + " of " + L.total : "Finding your start and the target...";
    const bar = $("nrt-lbar"); bar.setAttribute("aria-valuenow", pct); bar.firstElementChild.style.width = pct + "%";
    $("nrt-ln").textContent = (L.tier === "wider" ? "No short enough route yet, so the strip is wider now. " : "") + "Working out star positions in this browser, along the line from you to the target." + (avg ? " About " + avg + " ms a region." : "");
  }

  function failHtml() {
    const f = ui.fail || {}, row = '<div class="nrt-row"><button type="button" class="nrt-gold nrt-sm" data-nrt-act="replan">Try again</button></div>';
    if (f.kind === "start-unknown") return `<div class="nrt-panel"><b>Your position is not on the map.</b><p class="nrt-note">${esc(f.reason || "System " + hex(coordsOf(T.start.address).sys, 3) + " is not in the computed star list of its region.")} The region itself is not valid, so a route cannot start there. Check glyphs 2 to 4 (the system) and the other glyphs in Heading there.</p></div>${row}`;
    if (f.kind === "target-unknown") return `<div class="nrt-panel"><b>The target is not on the map.</b><p class="nrt-note">System ${hex(coordsOf(T.target.address).sys, 3)} is not in the computed star list of its region, so a route to it cannot be planned.</p></div>`;
    if (f.kind === "no-stars") return `<div class="nrt-panel"><b>No star in reach toward the target.</b><p class="nrt-note">No yellow star (system 1 to 120) lies within ${num(T.range)} ly of you in the direction of the target, so the first jump cannot be planned. A larger warp range may open a way.</p><label class="nrt-range" for="nrt-range">Warp range <input id="nrt-range" type="number" inputmode="numeric" min="50" max="99999" step="50" value="${T.range}" aria-label="Warp range in light years"> ly</label></div>`;
    if (f.kind === "other-galaxy") return `<div class="nrt-panel"><b>A different galaxy.</b><p class="nrt-note">The target is in ${esc(galName(T.gal))} and you are in ${esc(galName(coordsOf(T.start.address).gal))}. A route cannot cross galaxies, so none is planned.</p></div>`;
    if (f.kind === "too-many") return `<div class="nrt-panel"><b>Too far to draw in one go.</b><p class="nrt-note">Even a thin strip along this line needs about ${f.needed || "more than " + f.cap} regions and the limit is ${f.cap}. Plan it in stages: set a nearer target first.</p></div>`;
    if (f.kind === "no-route") {
      const c = f.closest;
      return `<div class="nrt-panel"><b>No route at ${num(T.range)} ly.</b><p class="nrt-note">${c ? "The closest you can get is " + esc(nameOf(addrOf(c.sys, T.gal, c.x, c.y, c.z))) + ", " + num(c.left) + " ly from the target (" + c.jumps + " jump" + (c.jumps === 1 ? "" : "s") + "). " : ""}A warp range of about <b>${num(f.needed)} ly</b> would connect you to the target through the stars searched. Some stars may need a drive upgrade.</p>
<label class="nrt-range" for="nrt-range">Warp range <input id="nrt-range" type="number" inputmode="numeric" min="50" max="99999" step="50" value="${T.range}" aria-label="Warp range in light years"> ly</label></div>`;
    }
    return `<div class="nrt-panel"><b>The route could not be planned.</b><p class="nrt-note">${esc(f.text || "")}</p></div>${row}`;
  }
  function offHtml() {
    const o = ui.off, c = coordsOf(o.address);
    return `<div class="nrt-panel nrt-offp"><b>You are not at the next stop.</b><p class="nrt-note">You checked in at ${esc(nameOf(o.address))} (system ${hex(c.sys, 3)}). The planned stop was ${esc(T.hops[T.done].name)}.</p><div class="nrt-row"><button type="button" class="nrt-gold nrt-sm" data-nrt-act="replan-here">Replan from here</button><button type="button" class="nrt-ghost" data-nrt-act="off-dismiss">Keep the old route</button></div></div>`;
  }
  function ciHtml() {
    const keys = Array.from({ length: 16 }, (_, i) => `<button type="button" data-nrt-g="${i.toString(16).toUpperCase()}" aria-label="Add glyph ${i.toString(16).toUpperCase()}"><img src="glyphs-svg/${i.toString(16)}.svg" alt=""></button>`).join("");
    return `<div class="nrt-ci"><label for="nrt-ci">After your jump, where are you now? Glyphs, address or booster</label><input id="nrt-ci" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="40" placeholder="Glyphs or address">
<div class="nrt-prev" id="nrt-prev" aria-label="Glyphs entered so far"></div><div class="nrt-keys">${keys}</div><div class="nrt-row"><button type="button" class="nrt-mini" data-nrt-del>Delete last</button><button type="button" class="nrt-mini" data-nrt-clr>Clear</button></div></div>`;
  }
  function syncPad() {
    const inp = $("nrt-ci"), prev = $("nrt-prev"); if (!inp || !prev) return;
    const t = inp.value.replace(/[\s-]/g, "").toUpperCase(), glyphs = /^[0-9A-F]{0,12}$/.test(t);
    prev.innerHTML = glyphs ? Array.from({ length: 12 }, (_, i) => (t[i] ? `<img src="glyphs-svg/${t[i].toLowerCase()}.svg" alt="">` : '<span aria-hidden="true">&middot;</span>')).join("") : "";
    prev.style.visibility = glyphs ? "visible" : "hidden";
    dlg.querySelectorAll(".nrt-keys button").forEach((b) => { b.disabled = !glyphs || t.length >= 12; });
  }

  // ------------------------------------------------------------------------------------------ actions
  async function copy(text, btn) {
    try { await navigator.clipboard.writeText(text); } catch (_) {
      try { const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); } catch (_2) { /* no clipboard */ }
    }
    ui.copied = text;
    if (btn) { const old = btn.textContent; btn.textContent = "Copied"; setTimeout(() => { btn.textContent = old; }, 1200); }
  }
  function syncNear(address, via) {   // keep the Near me trip in step: same history, so Heading there shows the new position
    try {
      const n = N(), S = n && n.state().S;
      if (!S || !S.trip || !S.trip.hist || S.trip.target.address !== T.target.address) return;
      S.trip.hist.push({ address, gal: T.gal, via, t: Date.now() }); if (S.trip.hist.length > 60) S.trip.hist.shift();
      // Near me saves and repaints when this window closes (onClose), so its own star map does not start a second worker meanwhile
    } catch (_) { /* Near me not there */ }
  }
  function doCheckIn() {
    const n = N(), inp = $("nrt-ci"); if (!inp) return;
    const say = (t, bad) => { ui.msg = t; ui.msgBad = !!bad; const m = $("nrt-msg"); if (m) { m.textContent = t; m.className = "nrt-msg" + (bad ? " bad" : ""); } };
    if (!n) { say("Check-in needs the Near me file, which did not load.", true); return; }
    const p = n.parsePos(inp.value, T.gal);
    if (!p.ok) { say(p.empty ? "Type your glyphs, address or booster first." : p.error, true); return; }
    if (p.gal !== T.gal) { say(`That address is in ${galName(p.gal)}, the route is in ${galName(T.gal)}. Check the galaxy.`, true); return; }
    const here = { sys: p.sys, x: p.x, y: p.y, z: p.z };
    let hit = -1;
    for (let i = T.done; i < T.hops.length; i++) { const c = coordsOf(T.hops[i].address); if (samePlace(c, here)) { hit = i; break; } }
    syncNear(p.address, p.kind);
    inp.value = "";
    if (hit >= 0) {
      T.done = hit + 1; ui.ci = false; ui.off = null; jset(T);
      if (T.done >= T.hops.length) { ui.screen = "done"; ui.msg = ""; } else say(`Checked in at ${T.hops[hit].name}. Next: jump ${T.done + 1} of ${T.hops.length}.`, false);
      paint(); drawSoon(); return;
    }
    ui.ci = false; ui.off = { address: p.address, kind: p.kind }; ui.msg = ""; paint();
  }
  function onClick(e) {
    const t = e.target instanceof Element ? e.target : null; if (!t) return;
    const tab = t.closest("[data-nrt-tab]"), act = t.closest("[data-nrt-act]"), cp = t.closest("[data-nrt-copy]"), g = t.closest("[data-nrt-g]");
    if (t.closest("[data-nrt-close]")) { dlg.close(); return; }
    const pt = t.closest("[data-nrt-part]");
    if (pt) { if (pt.disabled) return; const d = pt.dataset.nrtPart, c = curPart(); goPart(d === "first" ? 0 : d === "prev" ? c - 1 : c + 1); return; }
    if (tab) { if (viewT()) return; ui.tab = tab.dataset.nrtTab; paint(); return; }
    if (cp) { const h = (viewT() || T).hops[Number(cp.dataset.nrtCopy)]; if (h) copy(glyphsOf(h.address), cp); return; }
    if (g) { const inp = $("nrt-ci"), v = inp.value.replace(/[\s-]/g, ""); if (/^[0-9A-Fa-f]*$/.test(v) && v.length < 12) { inp.value = v + g.dataset.nrtG; syncPad(); } return; }
    if (t.closest("[data-nrt-del]")) { const inp = $("nrt-ci"); inp.value = inp.value.slice(0, -1); syncPad(); return; }
    if (t.closest("[data-nrt-clr]")) { const inp = $("nrt-ci"); inp.value = ""; syncPad(); return; }
    if (!act) return;
    const a = act.dataset.nrtAct;
    if (a === "stop") { stopPlan(); ui.screen = "stopped"; paint(); }
    else if (a === "next") { const L = T.hops[T.hops.length - 1]; if (L) startPlan(L.address, T.target.address, T.gal, T.range, "", (T.parts || []).concat([snapPart(T)])); }
    else if (a === "start") { T.started = true; ui.screen = "run"; ui.msg = ""; jset(T); paint(); }
    else if (a === "ci-open") { ui.ci = true; ui.msg = ""; ui.off = null; paint(); const i = $("nrt-ci"); if (i && !isTouch()) i.focus(); }
    else if (a === "ci-cancel") { ui.ci = false; paint(); }
    else if (a === "ci-go") doCheckIn();
    else if (a === "off-dismiss") { ui.off = null; paint(); }
    else if (a === "replan-here") { const o = ui.off; if (o) replanFrom(o.address); }
    else if (a === "replan") startPlan(T.start.address, T.target.address, T.gal, T.range, "", T.parts || []);   // plans this part again; the earlier parts stay
    else if (a === "clear") { try { localStorage.removeItem(KEY); } catch (_) { /* nothing */ } T.hops = []; dlg.close(); }
  }
  function onInput(e) {
    const t = e.target;
    if (t.id === "nrt-ci") syncPad();
    if (t.id === "nrt-range" && e.type === "change") {
      const v = Math.round(Number(t.value)); if (!(v >= 50 && v <= 99999)) { t.value = T.range; return; }
      if (v !== T.range) replanFrom(T.hops && T.started && T.done > 0 ? T.hops[T.done - 1].address : T.start.address, false, v);
    }
  }
  function replanFrom(startAddr, fromStart, range) {
    startPlan(startAddr, T.target.address, T.gal, range || T.range);
  }

  function open(opts) {
    opts = opts || {};
    const n = N(), S = n && n.state().S, trip = S && S.trip;
    const target = opts.target || (trip && trip.target.address), gal = opts.gal != null ? opts.gal : trip && trip.target.gal;
    const hist = trip && trip.hist && trip.hist.length ? trip.hist[trip.hist.length - 1].address : null, start = opts.start || hist;
    const range = Math.round(opts.range || (S && S.drive >= 50 ? S.drive : 1000));
    if (!target || !start || gal == null) return false;
    build();
    if (coordsOf(start).gal !== gal) {   // a route cannot cross galaxies
      T = { v: 1, gal, target: { address: target }, start: { address: start }, range, hops: [], total: 0, direct: 0, done: 0, started: false };
      Object.assign(ui, { screen: "fail", tab: "hops", fail: { kind: "other-galaxy" }, ci: false, off: null, msg: "", stars: [] });
      if (!dlg.open) dlg.showModal();
      paint(); return true;
    }
    if (!dlg.open) dlg.showModal();
    try { dlg.setAttribute("tabindex", "-1"); dlg.focus({ preventScroll: true }); } catch (_) { /* no focus */ }
    const saved = jget();
    ui.tab = "hops";
    // a saved route is picked up again only when it is for the same target and range and you are where it left you (the last check-in); otherwise it is planned again from your position
    const here = (a) => { const p = coordsOf(a), q = coordsOf(start); return p.gal === q.gal && samePlace(p, q); };
    if (saved && !opts.fresh && saved.target.address === target && saved.gal === gal && saved.hops && saved.hops.length && saved.range === range && here(saved.done > 0 ? saved.hops[saved.done - 1].address : saved.start.address)) {
      T = saved; T.parts = T.parts || []; ui.view = null; ui.screen = T.started ? (T.done >= T.hops.length ? "done" : "run") : "plan"; ui.ci = false; ui.off = null; ui.msg = ""; ui.stars = [];
      ui.stars = (T.stars || []).slice(); paint(); drawSoon();
      return true;
    }
    startPlan(start, target, gal, range);
    return true;
  }
  // ------------------------------------------------------------------------------------------ entry points
  document.addEventListener("click", (e) => {
    const b = e.target instanceof Element ? e.target.closest("[data-nrt-open]") : null;
    if (b) { e.preventDefault(); open(); }
  });
  globalThis.dvNearRoute = {
    open,
    // the Heading there top bar: a button for a target farther than one jump, a plain line otherwise (d and range in ly)
    hookHtml: (d, range) => (d > range ? "" : '<span class="nr-note nrt-inrange">In range of one jump</span>'),
    // v164: the big button in the bottom area of Heading there (beside the glyph keypad), only for a target farther than one jump
    bigHtml: (d, range) => (d > range
      ? `<button type="button" class="nrt-open nrt-bigplan" data-nrt-open aria-label="Plan route in hops"><svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="9" cy="37" r="4.5"/><circle cx="24" cy="15" r="4.5"/><circle cx="39" cy="31" r="4.5"/><path d="M12 33.5 21 19M28 17.5 36 27.5" stroke-dasharray="3 3"/></svg><b>Plan route in hops</b><small>Plan a far trip in jumps you can make</small></button>`
      : ""),
    modText: MOD_TEXT,
    pure,
    _test: {
      T: () => T, ui: () => ui, workerAlive: () => !!W.worker, loads: () => W.loads, cacheSize: () => W.cache.size, map: () => ({ stars: ui.stars.length / 3, cw: CW, ch: CH }),
      clearCache: () => W.cache.clear(),
      setTab: (t) => { ui.tab = t; paint(); },
      view: () => ui.view, goPart,
    },
  };
})();
