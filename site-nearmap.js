/* site-nearmap.js (SITE integration 2026-11-07, user: "a view inside the near me window showing your starting position and the system you
 * already selected as a destination"): the star map in the Near me check-in panel. Preview build work-v145-map only.
 *
 * Star positions come from stars/nms_stars.js (RE's browser port of the game's star builder, build 7.10), run in a module worker. Drawing,
 * camera and picking are the local star viewer's (re-full/notes/star_position_work/viewer/viewer.html), without its server, self test or
 * black hole / Atlas marks. Nothing is sent anywhere: the files are fetched from this site, the positions never leave the page.
 *
 *   dvNearMap.show(slot, req)  req = { gal, start: {x,y,z,sys}, target: {x,y,z,sys}, addr(sys,x,y,z) -> 16 hex digits, name(address) -> text }
 *                              x, y, z are signed region numbers. Puts the map in slot (the same element is reused by every call).
 *   dvNearMap.stop()           stops the worker (133 MB of wasm memory), drops the cache, takes the map out of the page.
 *
 * Near target (the target star is within 400 ly of the start): one block of 27 regions around the start (the list is complete to about 400 ly
 * from the start). Far target: a second block of 27 regions around the target, 54 regions at most; only stars within 400 ly of an end are
 * drawn and the view is zoomed out until both ends fit. Nothing is drawn between them. A star is found by its index in a region's list; if it
 * is not there the position is called unknown and nothing is drawn in its place.
 *
 * Scan mode (Near me redesign, SITE 2026-11-07, stage 1): dvNearMap.scanShow(slot, req) draws the stars within min(radius, 400) ly of the player,
 * tilted, all grey; dvNearMap.scanMark(address) gives one star its own colour once its system has been scanned (or is already known);
 * dvNearMap.scanMatch(address, label) puts the gold ring and label on it. A star is tied to a system number by its index in the region's list:
 * indexes 1..n are the numbers the scan walks (n = the region's star count, W29dRC.regionCount), 1001..1065 are the 65 purple extras (not drawn here:
 * their number in an address is not confirmed). req.regionOnly = true (Contribute scanning viewer, SITE v149) shows only the region of req.start
 * (1 region, not 27), centred on the region's middle, rings to 350 ly, labelled "Region centre"; req.start.sys is not used. The scan walks 1..n-9, so indexes above n-9 are never scanned and stay grey. */
(function () {
  "use strict";
  if (globalThis.dvNearMap) return;
  const SCRIPT = document.currentScript && document.currentScript.src;
  const BASE = new URL("stars/", SCRIPT || location.href).href;
  const NEAR_LY = 400, NEAR_U = NEAR_LY / 4, TIMEOUT_MS = 30000, CACHE_MAX = 216;
  const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
  const COLOR_TEXT = ["yellow", "red", "green", "blue", "purple", "not known"];
  const nf = (n) => Math.round(n).toLocaleString("en-US");
  const hex3 = (n) => (n & 0xfff).toString(16).toUpperCase().padStart(3, "0");
  const soft = (m) => Object.assign(new Error(m), { soft: true });

  // Markers (user 2026-11-07, RE: in the 3 regions checked, index 121 was BlackHole and 122 was Atlas in game memory). One constant for the wording.
  // A marker is drawn only for an index that exists in the region's list (index <= n, n = the region's star count); no other star is picked,
  // and nothing about exits, jumps or destinations is drawn.
  const ROUTE_PITCH = 0.8;   // the Heading there map opens tilted, like the scan map, so the rings read as rings
  const MARKERS = { 121: { key: "bh", label: "Black hole (from game data)" }, 122: { key: "atlas", label: "Atlas station (from game data, not visited)" } };
  const markOf = (idx, n) => (MARKERS[idx] && idx <= n ? MARKERS[idx] : null);
  const W = { api: null, worker: null, cache: new Map(), token: 0, key: "", root: null, req: null, D: null };

  // ------------------------------------------------------------------------------------------ module
  async function getApi() {
    if (W.api) return W.api;
    if (!globalThis.WebAssembly) throw soft("This browser has no WebAssembly.");
    if (!globalThis.Worker) throw soft("This browser cannot run the background worker.");
    if (!/^https?:$/.test(location.protocol)) throw soft("The star map needs the page to be opened from a web address.");
    let simd = false;
    try { simd = WebAssembly.validate(SIMD_PROBE); } catch (_) { simd = false; }
    if (!simd) throw soft("This browser has no WebAssembly SIMD.");
    try { W.api = await import(BASE + "nms_stars.js"); } catch (_) { throw soft("The star map files did not load."); }
    return W.api;
  }
  function killWorker() { if (W.worker) { try { W.worker.terminate(); } catch (_) { /* gone already */ } W.worker = null; } }
  function getWorker(api) {
    if (!W.worker) {
      try { W.loads = (W.loads || 0) + 1; W.worker = api.startStarWorker(new URL("nms_stars_worker.js", BASE)); } catch (_) { throw soft("The background worker did not start."); }
    }
    return W.worker;
  }
  const rkey = (gal, x, y, z) => gal + ":" + x + ":" + y + ":" + z;
  const blockKeys = (gal, c, rad = 1) => { const o = []; for (let dy = -rad; dy <= rad; dy++) for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) o.push(rkey(gal, c.x + dx, c.y + dy, c.z + dz)); return o; };
  // 27 regions around region c (signed region numbers). Calls are served one at a time by the worker.
  async function loadBlock(gal, c, token, note, rad = 1) {
    if (blockKeys(gal, c, rad).every((k) => W.cache.has(k))) return;
    const api = await getApi(), w = getWorker(api);
    let timer;
    const guard = new Promise((_, rej) => { timer = setTimeout(() => rej(soft("The star map took too long.")), TIMEOUT_MS); });
    const run = (async () => {
      let n = 0;
      for await (const r of w.buildView(gal, c.x, c.y, c.z, rad)) {
        if (token !== W.token) return;
        if (!(r.count >= 0 && r.count < 4000)) throw new Error("implausible star count");   // a normal region has about 600 stars: anything else is not worked out
        W.cache.set(rkey(gal, c.x + r.dx, c.y + r.dy, c.z + r.dz), { gx: c.x + r.dx, gy: c.y + r.dy, gz: c.z + r.dz, n: r.count, pos: r.positions, idx: r.index, col: r.color, rgba: r.rgba });
        note(++n);
      }
    })();
    try { await Promise.race([run, guard]); } catch (e) { killWorker(); throw e; } finally { clearTimeout(timer); }   // a load that hangs or fails ends the worker (it holds ~133 MB); the next load starts one
    if (W.cache.size > CACHE_MAX) for (const k of [...W.cache.keys()].slice(0, W.cache.size - CACHE_MAX)) W.cache.delete(k);
  }
  function findStar(gal, c, sys) {
    const r = W.cache.get(rkey(gal, c.x, c.y, c.z));
    if (!r) return null;
    for (let k = 0; k < r.n; k++) if (r.idx[k] === sys) return { r, k, g: [c.x * 100 + r.pos[3 * k], c.y * 100 + r.pos[3 * k + 1], c.z * 100 + r.pos[3 * k + 2]] };
    return null;
  }

  // ------------------------------------------------------------------------------------------ page parts
  function create() {
    const root = document.createElement("div");
    root.className = "nm";
    root.innerHTML = `<h4 class="nm-title">Star map</h4>
<div class="nm-wrap" id="nm-wrap"><canvas id="nm-cv" tabindex="0" role="img" aria-label="Star map. You are at the centre, the target is marked in orange."></canvas><div class="nm-tip" id="nm-tip" hidden></div>
<div class="nm-msg" id="nm-msg" role="status">Working out star positions...</div>
<div class="nm-leg" id="nm-leg" hidden></div>
<div class="nm-btns"><button type="button" class="nr-mini" id="nm-in" aria-label="Zoom in">+</button><button type="button" class="nr-mini" id="nm-out" aria-label="Zoom out">&minus;</button><button type="button" class="nr-mini" id="nm-reset">Reset view</button></div></div>
<p class="nr-note nm-fail" id="nm-fail" role="status" hidden></p>
<p class="nr-note nm-far" id="nm-far" hidden></p>
<p class="nr-note nm-cap" id="nm-cap">Star positions are worked out from the game's code. They were checked against one Euclid and one Galaxy 9 system on game build 7.10 (25 of 25 distances matched). Names are generated guesses. <span class="nm-sw"><i style="background:#ffcf10"></i>yellow <i style="background:#f20b39"></i>red <i style="background:#3eef12"></i>green <i style="background:#4b85ff"></i>blue <i style="background:#903fff"></i>purple</span></p>
<details class="nr-help nm-help"><summary>How to read this map</summary><ul><li>Drag to turn the view. On a phone, drag sideways. Pinch or use + and &minus; to zoom. Tap a star for its name.</li><li>The faint rings are distances from you. The pink arrow points toward the galaxy core; the core distance and direction are approximate.</li><li>The dashed line is the straight line between the two stars. The Distance left figure counts whole regions, so the two numbers differ.</li></ul></details>`;
    W.root = root;
    const $ = (id) => root.querySelector("#" + id);
    W.cv = $("nm-cv"); W.ctx = W.cv.getContext("2d"); W.wrap = $("nm-wrap"); W.tip = $("nm-tip"); W.msg = $("nm-msg"); W.fail = $("nm-fail"); W.far = $("nm-far");
    W.cv.addEventListener("pointerdown", onDown); W.cv.addEventListener("pointermove", onMove); W.cv.addEventListener("pointerup", onUp);
    W.cv.addEventListener("pointercancel", (e) => { ptrs.delete(e.pointerId); drag = null; });
    W.cv.addEventListener("pointerleave", () => { if (!pinned) W.tip.hidden = true; });
    W.cv.addEventListener("wheel", (e) => { e.preventDefault(); zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });   // wheel up zooms in, down zooms out
    $("nm-in").onclick = () => zoom(0.8); $("nm-out").onclick = () => zoom(1.25);
    $("nm-reset").onclick = () => { S.yaw = 0; S.pitch = S.mode === "scan" ? SCAN_PITCH : ROUTE_PITCH; S.fit = S.mode !== "scan"; if (S.mode === "scan") S.D = S.Dbase; invalidate(); };
    if (globalThis.ResizeObserver) new ResizeObserver(() => { resize(); }).observe(W.wrap);
    window.addEventListener("resize", resize);
  }
  function legend() {   // one entry per marker kind that is drawn in the picture now
    const el = W.root && W.root.querySelector("#nm-leg"); if (!el) return;
    const kinds = new Set();
    if (S.N && S.I && S.Ln) for (let k = 0; k < S.N; k++) { const m = markOf(S.I[k], S.Ln[S.Rk[k]]); if (m) kinds.add(m.key); }
    const html = ["121", "122"].filter((i) => kinds.has(MARKERS[i].key)).map((i) => `<span><i class="nm-ic ${MARKERS[i].key}"></i><b class="nm-t">${MARKERS[i].label}</b></span>`).join("");
    if (el.dataset.k !== html) { el.dataset.k = html; el.innerHTML = html; }
    el.hidden = !html;
  }
  function drawMarkers(ctx, M) {   // black hole and Atlas station icons at their star's place
    for (let j = 0; j < S.nvis; j++) {
      const k = S.vis[j], m = markOf(S.I[k], S.Ln[S.Rk[k]]); if (!m) continue;
      const x = S.sx[j], y = S.sy[j];
      ctx.save(); ctx.globalAlpha = 1; ctx.lineWidth = 1.6;
      if (m.key === "bh") { ctx.fillStyle = "#000"; ctx.strokeStyle = "#c9a0ff"; ctx.beginPath(); ctx.arc(x, y, 4, 0, 6.2832); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.ellipse(x, y, 8, 2.6, -0.4, 0, 6.2832); ctx.strokeStyle = "#c9a0ff88"; ctx.lineWidth = 1; ctx.stroke(); }
      else { ctx.fillStyle = "#06222e"; ctx.strokeStyle = "#7fe9ff"; ctx.beginPath(); ctx.moveTo(x, y - 6.5); ctx.lineTo(x + 6.5, y); ctx.lineTo(x, y + 6.5); ctx.lineTo(x - 6.5, y); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#7fe9ff"; ctx.beginPath(); ctx.arc(x, y, 1.6, 0, 6.2832); ctx.fill(); }
      ctx.restore();
    }
  }
  function setMsg(text) { W.msg.textContent = text || ""; W.msg.hidden = !text; }
  function setFail(text) {
    W.fail.hidden = !text; W.fail.textContent = text || "";
    W.wrap.hidden = !!text; W.root.querySelector("#nm-cap").hidden = !!text; W.root.querySelector(".nm-help").hidden = !!text; if (text) W.far.hidden = true; else resize();
  }

  // ------------------------------------------------------------------------------------------ data for the picture
  // S holds what is drawn: P = star positions in units (1 unit = 4 ly) from the start star, I = index, C = colour name, K = colour bucket
  const S = { mode: "route", N: 0, P: null, I: null, C: null, K: null, R: null, regs: [], keys: [0x888], start: null, target: null, core: null, coreLy: 0, tly: 0, far: false,
    yaw: 0, pitch: 0, D: 32, fit: true, dirty: false, hover: -1, sx: null, sy: null, sz: null, vis: null, nvis: 0, unknownTarget: false, ringMax: NEAR_LY, labels: null };

  function buildScene(req, sStar, tStar, tBlock) {
    const gal = req.gal, Gs = sStar.g, Gt = tStar ? tStar.g : null, R2 = NEAR_U * NEAR_U;
    const regions = [];
    const take = (c) => { for (const k of blockKeys(gal, c)) { const r = W.cache.get(k); if (r && !regions.includes(r)) regions.push(r); } };
    take(req.start); if (tBlock) take(req.target);
    let total = 0; for (const r of regions) total += r.n;
    const P = new Float32Array(3 * total), I = new Uint16Array(total), C = new Uint8Array(total), K = new Uint16Array(total), Rk = new Uint16Array(total), Kk = new Uint32Array(total);
    const keys = [0x888], map = new Map([[0x888, 0]]);
    let n = 0, ks = -1, kt = -1;
    const lowN = regions.map((r) => { let c = 0; for (let k = 0; k < r.n; k++) if (r.idx[k] < 1000) c++; return c; });
    regions.forEach((r, ri) => {
      const ox = r.gx * 100, oy = r.gy * 100, oz = r.gz * 100;
      for (let k = 0; k < r.n; k++) {
        const x = ox + r.pos[3 * k], y = oy + r.pos[3 * k + 1], z = oz + r.pos[3 * k + 2];
        const rx = x - Gs[0], ry = y - Gs[1], rz = z - Gs[2];
        let keep = rx * rx + ry * ry + rz * rz <= R2;
        if (!keep && tBlock && Gt) { const tx = x - Gt[0], ty = y - Gt[1], tz = z - Gt[2]; keep = tx * tx + ty * ty + tz * tz <= R2; }
        if (!keep) continue;
        P[3 * n] = rx; P[3 * n + 1] = ry; P[3 * n + 2] = rz; I[n] = r.idx[k]; C[n] = r.col[k]; Rk[n] = ri; Kk[n] = k;
        if (r.col[k] < 5) {
          const key = (Math.round(r.rgba[4 * k] * 15) << 8) | (Math.round(r.rgba[4 * k + 1] * 15) << 4) | Math.round(r.rgba[4 * k + 2] * 15);
          let id = map.get(key); if (id === undefined) { id = keys.length; keys.push(key); map.set(key, id); }
          K[n] = id;
        }
        if (r === sStar.r && k === sStar.k) ks = n;
        if (tStar && r === tStar.r && k === tStar.k) kt = n;
        n++;
      }
    });
    S.Ln = lowN; S.N = n; S.P = P.subarray(0, 3 * n); S.I = I.subarray(0, n); S.C = C.subarray(0, n); S.K = K.subarray(0, n); S.Rk = Rk.subarray(0, n); S.Kk = Kk.subarray(0, n); S.regs = regions; S.keys = keys;
    S.sx = new Float32Array(n); S.sy = new Float32Array(n); S.sz = new Float32Array(n); S.vis = new Int32Array(n); S.nvis = 0; S.hover = -1;
    S.start = { k: ks, sys: req.start.sys, c: req.start }; S.core = [-Gs[0], -Gs[1], -Gs[2]]; S.coreLy = Math.hypot(S.core[0], S.core[1], S.core[2]) * 4;
    S.target = tStar ? { k: kt, sys: req.target.sys, c: req.target, rel: [Gt[0] - Gs[0], Gt[1] - Gs[1], Gt[2] - Gs[2]] } : null;
    S.tly = S.target ? Math.hypot(S.target.rel[0], S.target.rel[1], S.target.rel[2]) * 4 : 0;
    S.far = !!tBlock;
    S.ringMax = S.far ? Math.max(NEAR_LY, Math.ceil(S.tly * 1.05 / 100) * 100) : NEAR_LY;
    S.yaw = 0; S.pitch = ROUTE_PITCH; S.D = 32; S.fit = true;
  }
  const addrOfStar = (k) => { const r = S.regs[S.Rk[k]], q = W.req; return q.addr(S.I[k], r.gx, r.gy, r.gz); };
  const nameOf = (k) => { try { return W.req.name(addrOfStar(k)) || ""; } catch (_) { return ""; } };
  const labelOfEnd = (e) => { const nm = (() => { try { return W.req.name(W.req.addr(e.sys, e.c.x, e.c.y, e.c.z)) || ""; } catch (_) { return ""; } })(); return nm || "system " + hex3(e.sys); };

  const APPROX = "The start is approximate (about here): the map is centred on the middle of the region, up to about 350 ly off.";
  async function startReason(gal, c) {   // v164: the real reason (see dvNear.sysReason in site-near.js)
    try { if (globalThis.dvNear && dvNear.sysReason) return (await dvNear.sysReason(gal, c.x, c.y, c.z, c.sys)).text; } catch (_) { /* plain text below */ }
    return `System ${hex3(c.sys)} is not in the computed list for its region.`;
  }
  async function load(req, token) {
    const gal = req.gal;
    setFail(""); setMsg("Working out star positions..."); W.far.hidden = true;
    const note = (n) => { if (token === W.token) setMsg("Working out star positions... " + n + " of 27 regions"); };
    await loadBlock(gal, req.start, token, note);
    if (token !== W.token) return;
    let sStar = findStar(gal, req.start, req.start.sys), approxTxt = "";
    if (!sStar) {
      const reason = await startReason(gal, req.start);
      const r0 = W.cache.get(rkey(gal, req.start.x, req.start.y, req.start.z));
      if (token !== W.token) return;
      if (r0 && r0.n > 0) { sStar = { r: r0, k: -1, g: [req.start.x * 100, req.start.y * 100, req.start.z * 100], approx: true }; approxTxt = reason + " " + APPROX; }   // v164: the region is real, so draw it around its middle
      else {
        S.N = 0; S.start = null; S.target = null; setMsg("");
        setFail(`${reason} Nothing is drawn. Near me still works.`);
        return;
      }
    }
    let tStar = null, tBlock = false, unknownT = false;
    const inBlock = Math.abs(req.target.x - req.start.x) <= 1 && Math.abs(req.target.y - req.start.y) <= 1 && Math.abs(req.target.z - req.start.z) <= 1;
    if (inBlock) {
      tStar = findStar(gal, req.target, req.target.sys);
      if (!tStar) unknownT = true;
      else if (Math.hypot(tStar.g[0] - sStar.g[0], tStar.g[1] - sStar.g[1], tStar.g[2] - sStar.g[2]) * 4 > NEAR_LY) tBlock = true;
    } else tBlock = true;
    if (tBlock) {
      await loadBlock(gal, req.target, token, (n) => { if (token === W.token) setMsg("Working out star positions around the target... " + n + " of 27 regions"); });
      if (token !== W.token) return;
      tStar = findStar(gal, req.target, req.target.sys);
      if (!tStar) { unknownT = true; tBlock = false; }
    }
    buildScene(req, sStar, tStar, tBlock);
    S.start.approx = !!sStar.approx;
    S.unknownTarget = unknownT;
    setMsg("");
    const far = []; if (approxTxt) far.push(approxTxt);
    if (unknownT) far.push(`The target position is unknown: system ${hex3(req.target.sys)} is not in the computed list for its region, so it is not marked.`);
    if (S.far) far.push(`The target is far, so only stars within ${NEAR_LY} ly of you and of the target are drawn (up to 54 regions). Nothing is drawn between them.`);
    W.far.hidden = !far.length; W.far.textContent = far.join(" ");
    W.root.setAttribute("data-nm", S.far ? "far" : unknownT ? "unknown-target" : "near");
    invalidate();
  }

  // ------------------------------------------------------------------------------------------ camera (the viewer's, core ahead)
  function viewMatrix() {
    const u = S.core || [0, 0, 1];
    let l = Math.hypot(u[0], u[1], u[2]) || 1; const f = [u[0] / l, u[1] / l, u[2] / l];
    let up = [0, 1, 0]; if (Math.abs(f[1]) > 0.999) up = [0, 0, 1];
    let rt = [f[1] * up[2] - f[2] * up[1], f[2] * up[0] - f[0] * up[2], f[0] * up[1] - f[1] * up[0]];
    l = Math.hypot(rt[0], rt[1], rt[2]); rt = rt.map((v) => v / l);
    const uv = [rt[1] * f[2] - rt[2] * f[1], rt[2] * f[0] - rt[0] * f[2], rt[0] * f[1] - rt[1] * f[0]];
    const B = [rt, uv, f];
    const cy = Math.cos(S.yaw), sy = Math.sin(S.yaw), cp = Math.cos(S.pitch), sp = Math.sin(S.pitch);
    const By = B.map((r) => [r[0] * cy + r[2] * -sy, r[1], r[0] * sy + r[2] * cy]);
    return [By[0][0], By[0][1], By[0][2], By[1][0] * cp - By[2][0] * sp, By[1][1] * cp - By[2][1] * sp, By[1][2] * cp - By[2][2] * sp,
      By[1][0] * sp + By[2][0] * cp, By[1][1] * sp + By[2][1] * cp, By[1][2] * sp + By[2][2] * cp];
  }
  const camOf = (M, v) => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];
  let CW = 600, CH = 400, DPR = 1;
  // scan mode: the ring of the largest radius is about 43 % of the width wide when S.D equals S.Dbase (zoom changes S.D)
  const focal = () => (S.mode === "scan" ? Math.min(0.43 * CW, 0.62 * CH) * S.Dbase / Math.max(1, S.scanR) : 1300 * Math.min(CH / 1080, CW / 1500));
  function resize() {
    if (!W.cv || !W.wrap || W.wrap.hidden) return;
    const r = W.cv.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    DPR = Math.min(2, window.devicePixelRatio || 1); CW = r.width; CH = r.height;
    W.root.classList.toggle("nm-small", CH < 230 || CW < 300);   // a small picture shows the legend as icons only (the words are in "About the map")
    const w = Math.round(CW * DPR), h = Math.round(CH * DPR);
    if (W.cv.width !== w || W.cv.height !== h) { W.cv.width = w; W.cv.height = h; }
    invalidate();
  }
  let raf = 0;
  function invalidate() { S.dirty = true; if (!raf && W.root && W.root.isConnected) raf = requestAnimationFrame(() => { raf = 0; if (S.dirty) draw(); }); }
  // zoom out until the target is on screen (the picture of a far target)
  function fitCamera(M) {
    if (!S.fit) return;
    S.fit = false;
    let D = 32;
    if (S.target && !S.unknownTarget) {
      const q = camOf(M, S.target.rel), f = focal();
      D = Math.max(D, f * Math.abs(q[0]) / (0.36 * CW) - q[2], f * Math.abs(q[1]) / (0.34 * CH) - q[2], 2.5 - q[2]);
    }
    S.D = D; S.maxD = Math.max(600, D * 4);
  }
  function project(M) {
    const f = focal(), cx = CW / 2, cy = CH / 2;
    let nv = 0;
    for (let k = 0; k < S.N; k++) {
      const x = S.P[3 * k], y = S.P[3 * k + 1], z = S.P[3 * k + 2];
      const zc = M[6] * x + M[7] * y + M[8] * z + S.D;
      if (zc < 0.5) continue;
      const sx = cx + f * (M[0] * x + M[1] * y + M[2] * z) / zc, sy = cy - f * (M[3] * x + M[4] * y + M[5] * z) / zc;
      if (sx < -20 || sx > CW + 20 || sy < -20 || sy > CH + 20) continue;
      S.sx[nv] = sx; S.sy[nv] = sy; S.sz[nv] = zc; S.vis[nv++] = k;
    }
    S.nvis = nv; S.grid = null;
  }
  function ringPts(ctx, M, f, rad) {
    const pts = []; let prev = false;
    ctx.beginPath();
    for (let a = 0; a <= 64; a++) {
      const t = a / 64 * Math.PI * 2, q = camOf(M, [rad * Math.cos(t), 0, rad * Math.sin(t)]), zc = q[2] + S.D;
      if (zc < 0.5) { prev = false; continue; }
      const x = CW / 2 + f * q[0] / zc, y = CH / 2 - f * q[1] / zc;
      if (prev) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      prev = true;
      if (!pts.length) pts.push(x, y);
    }
    ctx.stroke(); return pts;
  }
  function textAt(ctx, text, x, y, align) {
    const w = ctx.measureText(text).width;
    let px = x;
    if (align === "center") px = Math.min(CW - w / 2 - 4, Math.max(w / 2 + 4, x)); else if (align === "right") px = Math.max(w + 4, Math.min(CW - 4, x)); else px = Math.min(CW - w - 4, Math.max(4, x));
    const py = Math.min(CH - 6, Math.max(14, y)), keep = ctx.lineWidth, ink = ctx.strokeStyle;
    ctx.textAlign = align; ctx.lineJoin = "round"; ctx.lineWidth = 4; ctx.strokeStyle = "#05070bdd"; ctx.strokeText(text, px, py);   // dark edge: readable over stars
    ctx.fillText(text, px, py); ctx.textAlign = "left"; ctx.lineWidth = keep; ctx.strokeStyle = ink;
  }
  function draw() {
    if (S.mode === "scan") return drawScan();
    S.dirty = false;
    const ctx = W.ctx;
    if (!ctx || !S.N || !S.start || W.wrap.hidden) { if (ctx && !W.wrap.hidden) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = "#05070b"; ctx.fillRect(0, 0, W.cv.width, W.cv.height); } return; }
    if (CW < 10) resize();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.fillStyle = "#05070b"; ctx.fillRect(0, 0, CW, CH);
    const M = viewMatrix(); fitCamera(M);
    const L = {};
    const f = focal(), cx = CW / 2, cy = CH / 2;
    project(M);
    // rings: distances from you
    const steps = [25, 50, 100, 200, 400, 800, 1600, 3200, 6400, 12800]; let st = steps[steps.length - 1];
    for (const s of steps) if (S.ringMax / s <= 6) { st = s; break; }
    ctx.lineWidth = 1; ctx.font = "10px Segoe UI,Arial,sans-serif";
    for (let d = st; d <= S.ringMax; d += st) {
      ctx.strokeStyle = "#1c2a44"; const p = ringPts(ctx, M, f, d / 4);
      if (p.length) { ctx.fillStyle = "#4f6490"; ctx.fillText(nf(d) + " ly", p[0] + 3, p[1] - 3); }
    }
    // dots, bucketed by colour and depth
    const NB = 5, nK = S.keys.length, cnt = new Int32Array(nK * NB + 1), bk = new Int32Array(S.nvis);
    for (let j = 0; j < S.nvis; j++) {
      const k = S.vis[j], dz = S.sz[j] - S.D;
      let a = 0.62 - 0.5 * dz / NEAR_U; a = Math.max(0.1, Math.min(1, a));
      const b = Math.min(NB - 1, Math.floor(a * NB)); bk[j] = S.K[k] * NB + b; cnt[bk[j] + 1]++;
    }
    for (let i = 1; i < cnt.length; i++) cnt[i] += cnt[i - 1];
    const ord = new Int32Array(cnt[cnt.length - 1]), pos = cnt.slice();
    for (let j = 0; j < S.nvis; j++) ord[pos[bk[j]]++] = j;
    for (let b = 0; b < nK * NB; b++) {
      if (cnt[b] === cnt[b + 1]) continue;
      const key = S.keys[Math.floor(b / NB)];
      ctx.fillStyle = key === 0x888 ? "#8a93a0" : "rgb(" + (((key >> 8) & 15) * 17) + "," + (((key >> 4) & 15) * 17) + "," + ((key & 15) * 17) + ")";
      ctx.globalAlpha = 0.18 + 0.82 * ((b % NB) + 0.5) / NB;
      for (let q = cnt[b]; q < cnt[b + 1]; q++) { const j = ord[q], sz = Math.max(2.5, Math.min(7, 0.3 * f / S.sz[j])); ctx.fillRect(S.sx[j] - sz / 2, S.sy[j] - sz / 2, sz, sz); }
    }
    ctx.globalAlpha = 1;
    drawMarkers(ctx, M); legend();
    // target: dashed line and ring
    S.marks = { start: [cx, cy], target: null };
    if (S.target && !S.unknownTarget) {
      const q = camOf(M, S.target.rel), zc = q[2] + S.D;
      if (zc > 0.5) {
        const x = cx + f * q[0] / zc, y = cy - f * q[1] / zc;
        S.marks.target = [x, y];
        ctx.strokeStyle = "#ff9f43"; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke(); ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(x, y, 9, 0, 7); ctx.stroke(); ctx.fillStyle = "#ff9f43"; ctx.font = "12px Segoe UI,Arial,sans-serif";
        const lab = "TARGET " + labelOfEnd(S.target) + "  " + nf(Math.floor(S.tly)) + " ly";
        textAt(ctx, lab, x + (x + 14 + ctx.measureText(lab).width > CW - 4 ? -14 : 14), y - 10, x + 14 + ctx.measureText(lab).width > CW - 4 ? "right" : "left");
        L.target = lab;
      }
    }
    drawCore(ctx, M, L);
    // you
    ctx.strokeStyle = "#ffe08a"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, 9, 0, 7);
    ctx.moveTo(cx - 14, cy); ctx.lineTo(cx - 5, cy); ctx.moveTo(cx + 5, cy); ctx.lineTo(cx + 14, cy); ctx.moveTo(cx, cy - 14); ctx.lineTo(cx, cy - 5); ctx.moveTo(cx, cy + 5); ctx.lineTo(cx, cy + 14); ctx.stroke();
    ctx.fillStyle = "#ffe08a"; ctx.font = "bold 13px Segoe UI,Arial,sans-serif";
    const you = S.start.approx ? "About here" : labelOfEnd(S.start) + " (you)";
    textAt(ctx, you, cx, cy + 30 > CH - 8 ? cy - 20 : cy + 30, "center");
    L.start = you; S.labels = L;
    if (S.hover >= 0) { const j = S.hoverJ; if (j != null && S.vis[j] === S.hover) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(S.sx[j], S.sy[j], 8, 0, 7); ctx.stroke(); } }
    ctx.fillStyle = "#8d97ad"; ctx.font = "11px Segoe UI,Arial,sans-serif"; ctx.fillText(nf(S.nvis) + " systems drawn", 8, CH - 8);
  }
  function drawCore(ctx, M, L) {
    const q = camOf(M, S.core), l = Math.hypot(q[0], q[1], q[2]) || 1, qx = q[0] / l, qy = q[1] / l, qz = q[2] / l;
    const cx = CW / 2, cy = CH / 2, sinT = Math.hypot(qx, qy), len = 0.4 * Math.min(CW, CH) * sinT;
    ctx.strokeStyle = "#ff4fa8"; ctx.fillStyle = "#ff4fa8"; ctx.lineWidth = 3;
    const lab = "CORE about " + nf(Math.round(S.coreLy / 100) * 100) + " ly";
    L.core = lab;
    ctx.font = "bold 12px Segoe UI,Arial,sans-serif";
    if (len < 16) {
      ctx.beginPath(); ctx.arc(cx, cy, 20, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(cx, cy, 3, 0, 7); ctx.fill();
      textAt(ctx, lab + (qz > 0 ? " - straight ahead" : " - straight behind you"), cx, cy + 52, "center");
      return;
    }
    const dx = qx / sinT, dy = -qy / sinT, ex = cx + dx * len, ey = cy + dy * len;
    ctx.beginPath(); ctx.moveTo(cx + dx * 14, cy + dy * 14); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex - dx * 14 + dy * 8, ey - dy * 14 - dx * 8); ctx.lineTo(ex - dx * 14 - dy * 8, ey - dy * 14 + dx * 8); ctx.closePath(); ctx.fill();
    textAt(ctx, lab + (qz < 0 ? " (behind)" : ""), ex + dx * 6, ey + dy * 6, "left");
  }

  // ------------------------------------------------------------------------------------------ picking and touch
  const CELL = 24, ptrs = new Map();
  let drag = null, pinch0 = 0, pinned = false, tipTimer = 0;
  function pick(mx, my) {
    if (!S.N || !S.start) return -1;
    if (S.dirty) draw();
    const g = {}; let best = -1, bd = 1e9;
    for (let j = 0; j < S.nvis; j++) {
      const dx = S.sx[j] - mx, dy = S.sy[j] - my;
      if (Math.abs(dx) > 30 || Math.abs(dy) > 30) continue;
      const d = Math.hypot(dx, dy), tol = Math.max(8, 0.08 * focal() / S.sz[j]);
      if (d > tol) continue;
      const sc = d + S.sz[j] * 0.02;
      if (sc < bd) { bd = sc; best = j; }
    }
    S.hoverJ = best; return best < 0 ? -1 : S.vis[best];
  }
  function describe(k) {
    const a = addrOfStar(k), nm = nameOf(k), d = Math.hypot(S.P[3 * k], S.P[3 * k + 1], S.P[3 * k + 2]) * 4;
    const mk = S.Ln ? markOf(S.I[k], S.Ln[S.Rk[k]]) : null;
    return (mk ? mk.label + "\n" : "") + (nm ? nm + " (generated name, a best guess)" : "system " + hex3(S.I[k])) + "\n" + nf(Math.floor(d)) + (S.regionOnly ? " ly from the region centre" : " ly from you") + "\nglyphs 0" + a.slice(3, 6) + a.slice(8) + "\ncolour: " + COLOR_TEXT[S.C[k]]
      + (S.mode === "scan" ? "\n" + (S.skip[k] ? "not scanned: the last systems of a region are skipped" : S.st[k] ? (S.mlab.has(k) ? (S.regionOnly ? "find: " : "match: ") + S.mlab.get(k) : S.st[k] === 2 ? (S.regionOnly ? "checked by you" : "scanned in this run") : "already known (atlas or saved)") : "not scanned yet") : "");
  }
  function showTip(k, mx, my) {
    W.tip.textContent = describe(k); W.tip.hidden = false;
    W.tip.style.left = Math.max(4, Math.min(CW - 230, mx + 12)) + "px"; W.tip.style.top = Math.max(4, Math.min(CH - 90, my + 10)) + "px";
    S.hover = k; invalidate();
  }
  const posOf = (e) => { const r = W.cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  function onDown(e) {
    try { W.cv.setPointerCapture(e.pointerId); } catch (_) { /* not needed */ }
    const p = posOf(e); ptrs.set(e.pointerId, p); drag = { x: p[0], y: p[1], moved: 0 };
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); drag.moved = 99; }
  }
  function onMove(e) {
    const p = posOf(e);
    if (ptrs.has(e.pointerId)) {
      ptrs.set(e.pointerId, p);
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch0 > 0 && d > 0) zoom(pinch0 / d); pinch0 = d; return; }
      if (drag) {
        const dx = p[0] - drag.x, dy = p[1] - drag.y; drag.moved += Math.abs(dx) + Math.abs(dy); drag.x = p[0]; drag.y = p[1];
        if (drag.moved > 4) { S.yaw += dx * 0.005; S.pitch = Math.max(-1.5, Math.min(1.5, S.pitch - dy * 0.005)); W.tip.hidden = true; pinned = false; invalidate(); }
      }
      return;
    }
    if (e.pointerType === "mouse" && !pinned) { const k = pick(p[0], p[1]); if (k < 0) { W.tip.hidden = true; S.hover = -1; invalidate(); } else showTip(k, p[0], p[1]); }
  }
  function onUp(e) {
    const wasClick = drag && drag.moved <= 4 && ptrs.size === 1, p = posOf(e);
    ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch0 = 0;
    if (wasClick) {
      const k = pick(p[0], p[1]);
      clearTimeout(tipTimer);
      if (k < 0) { W.tip.hidden = true; pinned = false; S.hover = -1; invalidate(); }
      else { showTip(k, p[0], p[1]); pinned = e.pointerType !== "mouse"; if (pinned) tipTimer = setTimeout(() => { pinned = false; W.tip.hidden = true; S.hover = -1; invalidate(); }, 6000); }
    }
    drag = null;
  }
  function zoom(factor) { S.D = Math.max(S.mode === "scan" ? S.Dbase * 0.35 : 3, Math.min(S.maxD || 600, S.D * factor)); invalidate(); }

  // ------------------------------------------------------------------------------------------ scan mode (Near me redesign)
  const SCAN_PITCH = 1.0, STAR_CSS = ["#ffd21a", "#ff3b3b", "#3ee85a", "#3d8bff", "#b04bff"], GREY_CSS = "#9ba6b6";
  const signedN = (v, bits) => (v >= (1 << (bits - 1)) ? v - (1 << bits) : v);
  function parseAddr(a) {
    const lo = parseInt(String(a).slice(8), 16) >>> 0;
    return { sys: parseInt(String(a).slice(3, 6), 16), x: signedN(lo & 0xfff, 12), z: signedN((lo >>> 12) & 0xfff, 12), y: signedN(lo >>> 24, 8) };
  }
  const skey = (x, y, z, sys) => x + "," + y + "," + z + ":" + sys;
  // the stars of the 27-region block that lie within `limitLy` of the start, grey, with their system numbers
  function buildScan(req, sStar, limitLy) {
    const gal = req.gal, Gs = sStar.g, R2 = (limitLy / 4) * (limitLy / 4), regions = [];
    for (const k of blockKeys(gal, req.start, req.regionOnly ? 0 : 1)) { const r = W.cache.get(k); if (r) regions.push(r); }
    let total = 0; for (const r of regions) total += r.n;
    const P = new Float32Array(3 * total), I = new Uint16Array(total), C = new Uint8Array(total), Rk = new Uint16Array(total), st = new Uint8Array(total), skip = new Uint8Array(total);
    const lookup = new Map(); let n = 0, ks = -1, skipped = 0;
    const lowN = [];
    regions.forEach((r, ri) => {
      let low = 0; for (let k = 0; k < r.n; k++) if (r.idx[k] < 1000) low++;   // the region's star count (= W29dRC.regionCount)
      lowN[ri] = low;
      for (let k = 0; k < r.n; k++) {
        const idx = r.idx[k];
        if (idx >= 1000) continue;   // purple extras: number in an address not confirmed, not drawn
        const x = r.gx * 100 + r.pos[3 * k] - Gs[0], y = r.gy * 100 + r.pos[3 * k + 1] - Gs[1], z = r.gz * 100 + r.pos[3 * k + 2] - Gs[2];
        if (!req.regionOnly && x * x + y * y + z * z > R2) continue;   // regionOnly: by region membership, not radius (corner stars lie beyond 350 ly)
        P[3 * n] = x; P[3 * n + 1] = y; P[3 * n + 2] = z; I[n] = idx; C[n] = r.col[k]; Rk[n] = ri;
        if (idx > low - 9) { skip[n] = 1; skipped++; }
        lookup.set(skey(r.gx, r.gy, r.gz, idx), n);
        if (r === sStar.r && k === sStar.k) ks = n;
        n++;
      }
    });
    S.N = n; S.P = P.subarray(0, 3 * n); S.I = I.subarray(0, n); S.C = C.subarray(0, n); S.K = new Uint16Array(n); S.Rk = Rk.subarray(0, n); S.regs = regions;
    S.Ln = lowN; S.sel = -1; S.sellab = ""; S.st = st.subarray(0, n); S.skip = skip.subarray(0, n); S.mlab = new Map(); S.lookup = lookup; S.skipped = skipped;
    S.sx = new Float32Array(n); S.sy = new Float32Array(n); S.sz = new Float32Array(n); S.vis = new Int32Array(n); S.nvis = 0; S.hover = -1;
    S.start = { k: ks, sys: req.start.sys, c: req.start }; S.target = null; S.core = null; S.far = false; S.unknownTarget = false; S.regionOnly = !!req.regionOnly;
    S.scanR = limitLy / 4; S.ringMax = limitLy; S.Dbase = 600; S.D = 600; S.maxD = 1500; S.yaw = 0; S.pitch = SCAN_PITCH; S.fit = false;
  }
  // st: 0 = grey (not scanned), 1 = known from the atlas or saved rows (own colour, dimmed), 2 = finished by this scan (full colour)
  function scanApply(known, keep) {
    if (keep) { for (let k = 0; k < S.N; k++) if (S.st[k] !== 2) S.st[k] = 0; } else S.st.fill(0);
    if (!keep) { S.mlab = new Map(); S.sel = -1; S.sellab = ""; }
    if (typeof known === "function") for (let k = 0; k < S.N; k++) { if (S.skip[k] || S.st[k]) continue; if (known(addrOfStar(k))) S.st[k] = 1; }
    invalidate();
  }
  async function scanLoad(req, token) {
    const gal = req.gal;
    setFail(""); setMsg("Working out star positions..."); W.far.hidden = true;
    await loadBlock(gal, req.start, token, (n) => { if (token === W.token) setMsg("Working out star positions... " + n + (req.regionOnly ? " of 1 region" : " of 27 regions")); }, req.regionOnly ? 0 : 1);
    if (token !== W.token) return;
    // regionOnly (Contribute scanning viewer): one region, centred on the region's middle; no start star is needed
    let sStar = req.regionOnly ? (W.cache.get(rkey(gal, req.start.x, req.start.y, req.start.z)) ? { r: W.cache.get(rkey(gal, req.start.x, req.start.y, req.start.z)), k: -1, g: [req.start.x * 100, req.start.y * 100, req.start.z * 100] } : null) : findStar(gal, req.start, req.start.sys);
    let approxTxt = "";
    if (!sStar) {
      const reason = await startReason(gal, req.start), r0 = W.cache.get(rkey(gal, req.start.x, req.start.y, req.start.z));
      if (token !== W.token) return;
      if (r0 && r0.n > 0) { sStar = { r: r0, k: -1, g: [req.start.x * 100, req.start.y * 100, req.start.z * 100], approx: true }; approxTxt = reason + " " + APPROX; }   // v164: never block when the region is real
      else { S.N = 0; S.start = null; setMsg(""); throw soft(reason); }
    }
    const limit = req.regionOnly ? 350 : Math.max(25, Math.min(NEAR_LY, Number(req.radius) || NEAR_LY));
    S.mode = "scan"; buildScan(req, sStar, limit);
    if (S.start) S.start.approx = !!sStar.approx;
    if (approxTxt) { W.far.hidden = false; W.far.textContent = approxTxt; }
    W.root.setAttribute("data-nm", "scan"); W.root.classList.add("nm-scan");
    setMsg(""); scanApply(req.known); resize();
    const info = { ok: true, drawn: S.N, skipped: S.skipped, ringLy: limit, mapLy: NEAR_LY };
    if (req.onState) req.onState(info);
    return info;
  }
  function scanShow(slot, req) {
    if (!slot) return;
    if (!W.root) create();
    slot.appendChild(W.root);
    W.req = req;
    const lim = Math.max(25, Math.min(NEAR_LY, Number(req.radius) || NEAR_LY));
    const key = [req.regionOnly ? "region" : "scan", req.gal, req.start.x, req.start.y, req.start.z, req.start.sys, lim].join(",");
    if (key === W.key && S.mode === "scan") { W.root.classList.add("nm-scan"); resize(); invalidate(); if (req.onState) req.onState({ ok: true, drawn: S.N, skipped: S.skipped, ringLy: lim, mapLy: NEAR_LY }); return; }
    W.key = key;
    const token = ++W.token;
    S.mode = "scan"; S.N = 0; S.start = null; S.target = null;
    W.root.classList.add("nm-scan"); resize(); invalidate();
    scanLoad(req, token).catch((e) => {
      if (token !== W.token) return;
      W.key = ""; setMsg("");
      const m = (e && e.soft ? e.message : "The star positions could not be worked out here.") + " The map is off. The scan still works.";
      setFail(m);
      if (!(e && e.soft)) W.worker = (W.worker && (W.worker.terminate(), null));
      if (req.onState) req.onState({ ok: false, msg: m });
    });
  }
  const starOf = (a) => { if (S.mode !== "scan" || !S.lookup) return -1; const p = parseAddr(a), k = S.lookup.get(skey(p.x, p.y, p.z, p.sys)); return k === undefined ? -1 : k; };
  function scanMark(a) { const k = starOf(a); if (k < 0 || S.skip[k] || S.st[k] === 2) return false; S.st[k] = 2; invalidate(); return true; }
  function scanMatch(a, label) { const k = starOf(a); if (k < 0) return false; S.mlab.set(k, label); if (!S.skip[k] && !S.st[k]) S.st[k] = 1; invalidate(); return true; }
  function scanSelect(a, label) { const k = a ? starOf(a) : -1; S.sel = k; S.sellab = k >= 0 ? label || "" : ""; invalidate(); }
  function scanReset(known, keep) { if (S.mode === "scan" && S.N) scanApply(known, keep); }
  function drawScan() {
    S.dirty = false;
    const ctx = W.ctx;
    if (!ctx || W.wrap.hidden) return;
    if (CW < 10) resize();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, CW, CH);
    if (!S.N || !S.start) return;
    const M = viewMatrix(), f = focal(), cx = CW / 2, cy = CH / 2;
    project(M);
    // rings: distances from you, every 100 ly (every 50 up to 200 ly); labels at the right of each ring, the outer ones first, none on top of another
    const step = S.ringMax <= 200 ? 50 : 100;
    ctx.lineWidth = 1; ctx.font = "11px Segoe UI,Arial,sans-serif";
    const rings = [];
    for (let d = step; d <= S.ringMax + 0.5; d += step) rings.push(d);
    if (rings[rings.length - 1] !== S.ringMax && S.ringMax - rings[rings.length - 1] > step * 0.3) rings.push(S.ringMax);
    const labels = [];
    for (const d of rings) {
      ctx.strokeStyle = "#2f6f8f88"; ringPts(ctx, M, f, d / 4);
      const qa = camOf(M, [d / 4, 0, 0]), qb = camOf(M, [-d / 4, 0, 0]), q = qa[0] / (qa[2] + S.D) >= qb[0] / (qb[2] + S.D) ? qa : qb;
      labels.push({ d, lx: cx + f * q[0] / (q[2] + S.D), ly: cy - f * q[1] / (q[2] + S.D) });
    }
    const boxes = [], hit = (a, b) => a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];
    const youBox = [cx - 48, cy + 18, 96, 18], youCross = [cx - 16, cy - 16, 32, 32];
    boxes.push(youBox);
    ctx.textAlign = "left"; ctx.lineJoin = "round";
    for (const L of labels.reverse()) {
      const lab = nf(L.d) + " ly", lw = ctx.measureText(lab).width, tx = Math.max(2, Math.min(CW - lw - 3, L.lx + 4)), box = [tx - 2, L.ly - 15, lw + 4, 14];
      if (boxes.some((b) => hit(box, b))) continue;
      boxes.push(box); ctx.lineWidth = 3; ctx.strokeStyle = "#050d15cc"; ctx.fillStyle = "#7fb4cc"; ctx.strokeText(lab, tx, L.ly - 4); ctx.fillText(lab, tx, L.ly - 4);
    }
    // stars, far ones first: grey = not scanned, dim colour = known already, full colour = finished by this scan
    const order = Array.from({ length: S.nvis }, (_, j) => j).sort((a, b) => S.sz[b] - S.sz[a]);
    const px = Math.max(1.3, Math.min(2.3, CW / 300)), at = new Map();
    for (const j of order) {
      const k = S.vis[j], dz = S.sz[j] - S.D, st = S.st[k];
      at.set(k, j);
      if (markOf(S.I[k], S.Ln[S.Rk[k]])) continue;   // drawn as an icon below
      let a = 0.7 - 0.4 * dz / S.scanR; a = Math.max(0.3, Math.min(1, a));
      ctx.globalAlpha = st === 2 ? 0.95 : st === 1 ? 0.4 * a + 0.1 : 0.28 * a + 0.06;
      ctx.fillStyle = st ? STAR_CSS[S.C[k]] || GREY_CSS : GREY_CSS;
      const sz = st === 2 ? px * 1.5 : px;
      ctx.beginPath(); ctx.arc(S.sx[j], S.sy[j], sz / 2 + 0.3, 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;
    drawMarkers(ctx, M); legend();
    // matches: a gold ring on every one; the selected one is bigger and has the only text label
    for (const [k] of S.mlab) {
      const j = at.get(k); if (j === undefined || k === S.sel) continue;
      ctx.strokeStyle = "#ffc933"; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(S.sx[j], S.sy[j], 6, 0, 6.2832); ctx.stroke();
    }
    const sj = S.sel >= 0 ? at.get(S.sel) : undefined;
    S.labelBox = null;
    if (sj !== undefined) {
      const x = S.sx[sj], y = S.sy[sj];
      ctx.strokeStyle = "#ffc933"; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.arc(x, y, 9, 0, 6.2832); ctx.stroke();
      ctx.fillStyle = "#ffc933"; ctx.beginPath(); ctx.arc(x, y, 2.4, 0, 6.2832); ctx.fill();
      if (S.sellab) {
        ctx.font = "bold 12px Segoe UI,Arial,sans-serif";
        const w = ctx.measureText(S.sellab).width;
        const cands = [[14, 4], [-14 - w, 4], [14, -10], [-14 - w, -10], [14, 20], [-14 - w, 20], [-w / 2, -16], [-w / 2, 26]];
        let pick = null;
        const ok = (c, strict) => { const lx = x + c[0], ly = y + c[1], box = [lx - 2, ly - 12, w + 4, 16]; if (lx < 2 || lx + w > CW - 2 || ly < 12 || ly > CH - 4) return null; if (hit(box, youBox) || hit(box, youCross)) return null; if (strict && boxes.slice(1).some((b) => hit(box, b))) return null; return [lx, ly]; };
        for (const c of cands) { pick = ok(c, true); if (pick) break; }
        if (!pick) for (const c of cands) { pick = ok(c, false); if (pick) break; }
        if (pick) { ctx.lineWidth = 4; ctx.strokeStyle = "#050d15dd"; ctx.strokeText(S.sellab, pick[0], pick[1]); ctx.fillStyle = "#ffc933"; ctx.fillText(S.sellab, pick[0], pick[1]); S.labelBox = [pick[0] - 2, pick[1] - 12, w + 4, 16]; }
      }
    }
    // you
    ctx.strokeStyle = "#42e8f0"; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(cx, cy, 8, 0, 6.2832);
    ctx.moveTo(cx - 14, cy); ctx.lineTo(cx - 5, cy); ctx.moveTo(cx + 5, cy); ctx.lineTo(cx + 14, cy); ctx.moveTo(cx, cy - 14); ctx.lineTo(cx, cy - 5); ctx.moveTo(cx, cy + 5); ctx.lineTo(cx, cy + 14); ctx.stroke();
    ctx.fillStyle = "#42e8f0"; ctx.font = "13px Segoe UI,Arial,sans-serif"; ctx.textAlign = "center"; ctx.lineWidth = 3; ctx.strokeStyle = "#050d15cc"; ctx.strokeText(S.regionOnly ? "Region centre" : "You are here", cx, cy + 30); ctx.fillText(S.regionOnly ? "Region centre" : "You are here", cx, cy + 30); ctx.textAlign = "left";
    S.labels = { start: S.regionOnly ? "Region centre" : "You are here" };
    if (S.hover >= 0) { const j = S.hoverJ; if (j != null && S.vis[j] === S.hover) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(S.sx[j], S.sy[j], 8, 0, 7); ctx.stroke(); } }
  }

  // ------------------------------------------------------------------------------------------ public
  function show(slot, req) {
    if (!slot) return;
    if (!W.root) create();
    slot.appendChild(W.root);
    W.req = req;
    const key = [req.gal, req.start.x, req.start.y, req.start.z, req.start.sys, req.target.x, req.target.y, req.target.z, req.target.sys].join(",");
    if (key === W.key && S.mode === "route") { W.root.classList.remove("nm-scan"); resize(); invalidate(); return; }
    W.key = key;
    const token = ++W.token;
    S.mode = "route"; S.N = 0; S.start = null; S.target = null; S.unknownTarget = false; if (W.root) W.root.classList.remove("nm-scan");
    resize(); invalidate();
    load(req, token).catch((e) => {
      if (token !== W.token) return;
      W.key = "";
      setMsg("");
      setFail((e && e.soft ? e.message : "The star positions could not be worked out here.") + " The star map is off. Near me still works.");
      if (!(e && e.soft)) W.worker = (W.worker && (W.worker.terminate(), null));   // an untraced path in the builder: start clean next time
    });
  }
  function hold() {   // no picture (the position is incomplete or not in the galaxy): the one worker stays for the next position
    W.token++; W.key = ""; S.N = 0; S.start = null; S.target = null; S.st = null; S.mlab = new Map(); S.sel = -1; S.lookup = null;
    setMsg(""); invalidate();
  }
  function stop() {
    W.token++; W.key = "";
    if (W.worker) { try { W.worker.terminate(); } catch (_) { /* gone already */ } W.worker = null; }
    W.cache.clear(); S.N = 0; S.P = null; S.start = null; S.target = null; S.regs = [];
    if (W.root && W.root.parentNode) W.root.parentNode.removeChild(W.root);
    ptrs.clear(); drag = null; clearTimeout(tipTimer);
  }
  globalThis.dvNearMap = {
    show, stop, hold, scanShow, scanMark, scanMatch, scanSelect, scanReset, MARKERS,
    _test: {
      workerAlive: () => !!W.worker,
      screens: () => { const o = []; for (let j = 0; j < S.nvis; j++) o.push([S.vis[j], S.sx[j], S.sy[j], S.sz[j]]); return o; },
      zoomD: () => S.D,
      // a fixed point of the scene on the line between the camera and the centre (what a grab-style drag must carry with the pointer), and where it is on screen now
      probeWorld: () => { const M = viewMatrix(); return [M[0] * 0 + M[3] * 0 + M[6] * -30, M[1] * 0 + M[4] * 0 + M[7] * -30, M[2] * 0 + M[5] * 0 + M[8] * -30]; },
      projectWorld: (w) => { const M = viewMatrix(), q = camOf(M, w), f = focal(); return [CW / 2 + f * q[0] / (q[2] + S.D), CH / 2 - f * q[1] / (q[2] + S.D)]; },
      loads: () => W.loads || 0,
      markKind: (idx, n) => { const m = markOf(idx, n); return m ? m.key : null; },
      markers: () => { const o = []; for (let k = 0; k < S.N; k++) { const m = S.Ln ? markOf(S.I[k], S.Ln[S.Rk[k]]) : null; if (m) o.push({ idx: S.I[k], key: m.key, label: m.label }); } return o; },
      legend: () => { const e = W.root && W.root.querySelector("#nm-leg"); return e && !e.hidden ? e.textContent : ""; },
      label: () => ({ sel: S.sel, text: S.sellab, box: S.labelBox || null, you: [CW / 2 - 48, CH / 2 + 18, 96, 18] }),
      scan: () => ({ mode: S.mode, N: S.N, coloured: S.st ? S.st.reduce((a, b) => a + (b ? 1 : 0), 0) : 0, full: S.st ? S.st.reduce((a, b) => a + (b === 2 ? 1 : 0), 0) : 0, dim: S.st ? S.st.reduce((a, b) => a + (b === 1 ? 1 : 0), 0) : 0, skipped: S.skipped, matches: S.mlab ? S.mlab.size : 0, ringMax: S.ringMax, cw: CW, ch: CH }),
      scanStar: (a) => { const k = starOf(a); return k < 0 ? null : { k, coloured: !!S.st[k], skip: !!S.skip[k], match: S.mlab.get(k) || "", colour: S.C[k], idx: S.I[k] }; },
      scanAll: () => { const o = []; for (let k = 0; k < S.N; k++) o.push([addrOfStar(k), S.st[k], S.skip[k]]); return o; },
      region: (gal, x, y, z) => { const r = W.cache.get(rkey(gal, x, y, z)); return r ? { n: r.n, idx: Array.from(r.idx), pos: Array.from(r.pos), col: Array.from(r.col) } : null; },
      cacheSize: () => W.cache.size,
      state: () => ({ N: S.N, far: S.far, unknownTarget: S.unknownTarget, tly: S.tly, coreLy: S.coreLy, labels: S.labels, marks: S.marks, D: S.D, ringMax: S.ringMax,
        startG: S.start && S.start.k >= 0 ? true : false, targetRel: S.target && S.target.rel, cw: CW, ch: CH, regions: S.regs.length, nvis: S.nvis,
        dpr: DPR, targetStarK: S.target ? S.target.k : -1 }),
    },
  };
})();
